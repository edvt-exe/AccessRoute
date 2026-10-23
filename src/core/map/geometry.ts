import type { Point } from "./types";
import { averageHeading, normalizeHeading, turnAngle } from "./walking";

const rad = Math.PI / 180;

export function advance(from: Point, heading: number, metres: number): Point {
  return { x: from.x + Math.sin(heading * rad) * metres, y: from.y + Math.cos(heading * rad) * metres };
}

export function distance(a: Point, b: Point) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function headingBetween(a: Point, b: Point) {
  return normalizeHeading((Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI);
}

// most rooms have walls at right angles to the entrance, so directions close to one of the
// four axes are straightened. this removes most of the drift a phone sensor builds up
export function snapHeading(heading: number, tolerance = 20) {
  const nearest = Math.round(heading / 90) * 90;
  return Math.abs(turnAngle(heading, nearest)) <= tolerance ? normalizeHeading(nearest) : normalizeHeading(heading);
}

// spreads the gap between where a loop ended and where it started over the whole loop
export function closeLoop(points: Point[], target: Point = points[0]) {
  if (points.length < 2) return { points, error: 0 };
  const last = points[points.length - 1];
  const error = { x: target.x - last.x, y: target.y - last.y };
  let total = 0;
  const along = points.map((p, i) => (i === 0 ? 0 : (total += distance(points[i - 1], p))));
  const corrected = points.map((p, i) => {
    const share = total === 0 ? 0 : along[i] / total;
    return { x: p.x + error.x * share, y: p.y + error.y * share };
  });
  return { points: corrected, error: Math.hypot(error.x, error.y) };
}

type Run = { heading: number; steps: number };

// the closest spot inside the room that keeps a margin from the walls; a person cannot walk
// through a wall, so a position the sensors put outside is pulled back in
export function clampInside(point: Point, polygon: Point[], margin = 0.3): Point {
  if (polygon.length < 3) return point;
  if (pointInPolygon(point, polygon) && distanceToOutline(point, polygon) >= margin) return point;
  let best: Point = point;
  let bestDistance = Infinity;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i];
    const b = polygon[(i + 1) % polygon.length];
    const { t } = distanceToSegment(point, a, b);
    const q = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const length = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    // both normals of the wall, the one that ends up inside the room wins
    for (const sign of [1, -1]) {
      const candidate = { x: q.x + (sign * -(b.y - a.y) / length) * margin, y: q.y + (sign * (b.x - a.x) / length) * margin };
      if (!pointInPolygon(candidate, polygon)) continue;
      const d = distance(point, candidate);
      if (d < bestDistance) {
        bestDistance = d;
        best = candidate;
      }
    }
  }
  return bestDistance === Infinity ? point : best;
}

type RawRun = { samples: number[]; steps: number };

// one heading per detected step -> straight wall pieces with their measured direction.
// a step joins the current wall when it points within 30 degrees of the last few steps
export function runsFromSteps(headings: number[]): Run[] {
  const runs: RawRun[] = [];
  for (const heading of headings) {
    const last = runs.at(-1);
    const recent = last ? averageHeading(last.samples.slice(-6)) : null;
    if (last && recent !== null && Math.abs(turnAngle(recent, heading)) < 30) {
      last.samples.push(heading);
      last.steps++;
    } else {
      runs.push({ samples: [heading], steps: 1 });
    }
  }
  // one or two odd steps are a wobble (going round a chair, looking back), not a corner of the room
  const cleaned: RawRun[] = [];
  for (const run of runs) {
    const last = cleaned.at(-1);
    if (last && run.steps < 3) last.steps += run.steps;
    else cleaned.push({ samples: [...run.samples], steps: run.steps });
  }
  if (cleaned.length > 1 && cleaned[0].steps < 3) {
    cleaned[1].steps += cleaned[0].steps;
    cleaned.shift();
  }
  const merged: RawRun[] = [];
  for (const run of cleaned) {
    const last = merged.at(-1);
    const a = last ? averageHeading(last.samples) : null;
    const b = averageHeading(run.samples);
    if (last && a !== null && b !== null && Math.abs(turnAngle(a, b)) < 30) {
      last.samples.push(...run.samples);
      last.steps += run.steps;
    } else {
      merged.push(run);
    }
  }
  return merged.map((run) => ({ heading: averageHeading(run.samples) ?? run.samples[0], steps: run.steps }));
}

// how far the gyroscope has drifted is followed wall by wall. a long wall is trusted, a wall of one or
// two steps (turning in a corner, a hesitation) barely moves the estimate, so one bad wall cannot
// rotate everything after it
function followDrift(runs: Run[]) {
  let drift = 0;
  return runs.map((run) => {
    const axis = normalizeHeading(Math.round((run.heading - drift) / 90) * 90 + drift);
    const residual = turnAngle(axis, run.heading);
    // a wall far off every axis was measured mid turn, it says little about the drift
    const trust = Math.abs(residual) <= 25 ? 1 : 0.2;
    drift += residual * trust * (run.steps / (run.steps + 3));
    return { heading: normalizeHeading(Math.round((run.heading - drift) / 90) * 90), steps: run.steps };
  });
}

// office rooms have right angles, so every wall is put on one of the four axes of the room.
// a slanted wall is rare and is fixed by dragging its corners in the review
export function straightenRuns(runs: Run[]): Run[] {
  const walls = followDrift(runs);
  const result: Run[] = [];
  for (const wall of walls) {
    const last = result.at(-1);
    if (last && last.heading === wall.heading) {
      // a corner pressed in the middle of a wall
      last.steps += wall.steps;
    } else if (last && Math.abs(turnAngle(last.heading, wall.heading)) === 180 && wall.steps <= 2) {
      // a step back while turning, not a wall
      last.steps = Math.max(0, last.steps - wall.steps);
    } else {
      result.push({ ...wall });
    }
  }
  // a wall of one step between two walls going the same way is a wobble, it would leave a tiny notch
  const cleaned: Run[] = [];
  for (let i = 0; i < result.length; i++) {
    const before = cleaned.at(-1);
    const after = result[i + 1];
    if (before && after && result[i].steps <= 1 && before.heading === after.heading) {
      before.steps += after.steps;
      i++;
    } else {
      cleaned.push(result[i]);
    }
  }
  return cleaned.filter((wall) => wall.steps > 0);
}

// the walk ends where it started, so walls going one way must add up to walls going the other way.
// each side is stretched or shrunk to the average of both, which keeps every angle as it is
function balance(vectors: Point[]) {
  const fix = (key: "x" | "y") => {
    const plus = vectors.reduce((sum, v) => sum + Math.max(0, v[key]), 0);
    const minus = vectors.reduce((sum, v) => sum + Math.max(0, -v[key]), 0);
    if (plus < 0.01 || minus < 0.01) return false;
    const target = (plus + minus) / 2;
    for (const v of vectors) v[key] *= v[key] > 0 ? target / plus : target / minus;
    return true;
  };
  return fix("x") && fix("y");
}

// the wall walk -> a closed outline that starts at the entrance
export function outlineFromSteps(headings: number[], stepLength: number) {
  return outlineFromRuns(straightenRuns(runsFromSteps(headings)), stepLength);
}

// the recorder pressed "corner" in every corner: each wall is exactly the steps between two presses,
// its direction the average of those steps. no guessing where the corners are
export function outlineFromCorners(headings: number[], cornerSteps: number[], stepLength: number) {
  return outlineFromRuns(straightenRuns(wallsBetween(headings, cornerSteps)), stepLength);
}

function wallsBetween(headings: number[], cornerSteps: number[]) {
  const cuts = [...new Set([0, ...cornerSteps.filter((i) => i > 0 && i < headings.length), headings.length])].sort((a, b) => a - b);
  const walls: Run[] = [];
  for (let i = 1; i < cuts.length; i++) {
    const part = headings.slice(cuts[i - 1], cuts[i]);
    const heading = averageHeading(part);
    if (part.length > 0 && heading !== null) walls.push({ heading, steps: part.length });
  }
  return walls;
}

// the walls walked so far, straightened the same way as the final outline, for the live preview
export function wallsSoFar(headings: number[], cornerSteps: number[], stepLength: number) {
  const points: Point[] = [{ x: 0, y: 0 }];
  for (const wall of straightenRuns(wallsBetween(headings, cornerSteps))) {
    points.push(round(advance(points.at(-1)!, wall.heading, wall.steps * stepLength)));
  }
  return points;
}

function outlineFromRuns(runs: Run[], stepLength: number) {
  const vectors = runs.map((run) => {
    const end = advance({ x: 0, y: 0 }, run.heading, run.steps * stepLength);
    return { x: end.x, y: end.y };
  });
  const gap = vectors.reduce((sum, v) => ({ x: sum.x + v.x, y: sum.y + v.y }), { x: 0, y: 0 });
  const closureError = Math.round(Math.hypot(gap.x, gap.y) * 100) / 100;

  let corners: Point[];
  if (balance(vectors)) {
    corners = [{ x: 0, y: 0 }];
    for (const v of vectors) corners.push({ x: corners.at(-1)!.x + v.x, y: corners.at(-1)!.y + v.y });
  } else {
    const open: Point[] = [{ x: 0, y: 0 }];
    for (const run of runs) open.push(advance(open.at(-1)!, run.heading, run.steps * stepLength));
    corners = closeLoop(open).points;
  }
  // the last corner is the entrance again
  return { outline: corners.slice(0, -1).map(round), closureError };
}

export function round(p: Point): Point {
  // + 0 turns -0 into 0, which keeps stored maps tidy
  return { x: Math.round(p.x * 100) / 100 + 0, y: Math.round(p.y * 100) / 100 + 0 };
}

export function pointInPolygon(point: Point, polygon: Point[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (a.y > point.y !== b.y > point.y && point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

export function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;
  const t = length === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
  return { distance: Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy)), t };
}

export function distanceToOutline(p: Point, outline: Point[]) {
  let best = Infinity;
  for (let i = 0; i < outline.length; i++) {
    best = Math.min(best, distanceToSegment(p, outline[i], outline[(i + 1) % outline.length]).distance);
  }
  return best;
}

// positive when the point is on the right of someone walking from a to b
export function sideOf(p: Point, a: Point, b: Point) {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x) < 0 ? "right" : "left";
}

export function bounds(points: Point[]) {
  return {
    minX: Math.min(...points.map((p) => p.x)),
    maxX: Math.max(...points.map((p) => p.x)),
    minY: Math.min(...points.map((p) => p.y)),
    maxY: Math.max(...points.map((p) => p.y)),
  };
}

// changes the length of one wall and keeps every corner a right angle: the next wall slides
// along, so the wall after it gets longer or shorter by the same amount. the entrance never moves
export function setWallLength(outline: Point[], index: number, length: number): Point[] {
  const n = outline.length;
  if (n < 3 || length <= 0) return outline;
  const a = outline[index];
  const b = outline[(index + 1) % n];
  const current = distance(a, b);
  if (current === 0) return outline;
  const ux = (b.x - a.x) / current;
  const uy = (b.y - a.y) / current;
  const change = length - current;
  // slide the wall after this one forwards, or the wall before it backwards when that one holds the entrance
  const forward = [(index + 1) % n, (index + 2) % n];
  const backward = [index, (index - 1 + n) % n];
  const [move, sign] = !forward.includes(0) ? [forward, 1] : !backward.includes(0) ? [backward, -1] : [[(index + 1) % n], 1];
  return outline.map((p, i) => (move.includes(i) ? round({ x: p.x + ux * change * sign, y: p.y + uy * change * sign }) : p));
}

// the point a share of the way round the outline, starting at the entrance, and the direction of that wall
export function pointAlongOutline(outline: Point[], share: number) {
  const n = outline.length;
  const lengths = outline.map((p, i) => distance(p, outline[(i + 1) % n]));
  const total = lengths.reduce((a, b) => a + b, 0);
  let left = Math.min(Math.max(share, 0), 1) * total;
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    if (left <= lengths[i] || i === n - 1) {
      const t = lengths[i] === 0 ? 0 : Math.min(left / lengths[i], 1);
      return { point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, heading: headingBetween(a, b) };
    }
    left -= lengths[i];
  }
  return { point: outline[0], heading: 0 };
}

export type ObstacleSize = "small" | "medium" | "large";

// small, medium and large are measured against the room: in a 3 m wide room a large table cannot be 2 m
// across. each size is a share of the narrowest side of the room, never more than in a big room
const obstaclePresets: Record<ObstacleSize, { radius: number; share: number; least: number }> = {
  small: { radius: 0.3, share: 0.06, least: 0.15 },
  medium: { radius: 0.6, share: 0.1, least: 0.2 },
  large: { radius: 1, share: 0.16, least: 0.3 },
};

export function obstacleRadius(size: ObstacleSize, outline: Point[]) {
  const preset = obstaclePresets[size];
  if (outline.length < 3) return preset.radius;
  const b = bounds(outline);
  const narrow = Math.min(b.maxX - b.minX, b.maxY - b.minY);
  return Math.round(Math.min(preset.radius, Math.max(preset.least, narrow * preset.share)) * 100) / 100;
}

// the size whose radius is closest, for showing a stored obstacle in a size list
export function obstacleSizeOf(radius: number, outline: Point[]): ObstacleSize {
  const sizes: ObstacleSize[] = ["small", "medium", "large"];
  return sizes.reduce((a, b) => (Math.abs(obstacleRadius(b, outline) - radius) < Math.abs(obstacleRadius(a, outline) - radius) ? b : a));
}
