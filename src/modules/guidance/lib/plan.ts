import {
  clampInside,
  defaultStepLength,
  describeTurn,
  distance,
  distanceToOutline,
  distanceToSegment,
  headingBetween,
  pointInPolygon,
  sideOf,
  stepsFor,
  turnAngle,
  type FloorMap,
  type Point,
  type Spot,
} from "@/core/map";

const cell = 0.2; // grid resolution in metres
const wallClearance = 0.35; // keep this far from walls
const obstacleClearance = 0.45; // and this far from the edge of obstacles
const warnDistance = 1.2; // obstacles closer than this to the path are announced
// walking along a wall the cane touches it, so a person corrects small errors by touch. the route keeps
// to this band beside the walls and crosses open floor only when that is much shorter
const caneReach = 0.95;
const openFloor = 1.8; // a metre of open floor costs as much as this many metres along a wall
// stairs and things at head height get more room than an ordinary obstacle
const hazardClearance: Record<string, number> = { stairs: 0.6, head: 0.3, glass: 0 };

// pass: an obstacle beside the way; hazard: one a cane does not find or that needs care; door: a door that
// can swing open towards the person; around: something standing against the wall that is followed
export type Warning = { spot: Spot; side: "left" | "right"; atMetres: number; kind: "pass" | "hazard" | "door" | "around" };

// the wall a stretch follows, and what lines it there (a sofa, cabinets) when the recorder said so
export type WallFollow = { side: "left" | "right"; index: number; along: string | null; glass: boolean };
// what the person can feel at the end of a stretch: a corner, a door frame, or the wall itself when walking up to it
export type Landmark = { kind: "corner" } | { kind: "door"; spot: Spot } | { kind: "wall" };

export type Leg = {
  from: Point;
  to: Point;
  heading: number;
  metres: number;
  warnings: Warning[];
  wall: WallFollow | null;
  end: Landmark | null;
};

export type PathPlan =
  | { ok: true; legs: Leg[]; points: Point[]; goal: Spot }
  | { ok: false; reason: "unknown-place" | "destination-blocked" | "no-path" | "already-there" };

type Grid = {
  free: Uint8Array;
  band: Uint8Array; // 1 where a cane reaches the wall
  cols: number;
  rows: number;
  originX: number;
  originY: number;
};

function buildGrid(map: FloorMap, keepFree: Point[], wallGap = wallClearance): Grid {
  const xs = map.outline.map((p) => p.x);
  const ys = map.outline.map((p) => p.y);
  const originX = Math.min(...xs) - cell;
  const originY = Math.min(...ys) - cell;
  const cols = Math.ceil((Math.max(...xs) - originX) / cell) + 2;
  const rows = Math.ceil((Math.max(...ys) - originY) / cell) + 2;
  const free = new Uint8Array(cols * rows);
  const band = new Uint8Array(cols * rows);
  const obstacles = map.spots.filter((s) => s.kind === "obstacle");
  // something standing against a wall (a cabinet, a printer) is felt with the cane like the wall itself
  const againstWall = obstacles.filter((o) => o.hazard !== "head" && distanceToOutline(o, map.outline) - o.radius <= 0.8);

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = { x: originX + c * cell, y: originY + r * cell };
      const nearKept = keepFree.some((k) => distance(k, p) < 0.6);
      if (!pointInPolygon(p, map.outline) && !nearKept) continue;
      const toWall = distanceToOutline(p, map.outline);
      if (!nearKept && toWall < wallGap) continue;
      if (obstacles.some((o) => distance(o, p) < o.radius + obstacleClearance + (o.hazard ? hazardClearance[o.hazard] : 0))) continue;
      free[r * cols + c] = 1;
      if (toWall <= caneReach || againstWall.some((o) => distance(o, p) - o.radius <= caneReach)) band[r * cols + c] = 1;
    }
  }
  return { free, band, cols, rows, originX, originY };
}

const toCell = (g: Grid, p: Point) => ({ c: Math.round((p.x - g.originX) / cell), r: Math.round((p.y - g.originY) / cell) });
const toPoint = (g: Grid, c: number, r: number) => ({ x: g.originX + c * cell, y: g.originY + r * cell });
const isFree = (g: Grid, c: number, r: number) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && g.free[r * g.cols + c] === 1;
const weight = (g: Grid, c: number, r: number) => (g.band[r * g.cols + c] ? 1 : openFloor);

// free cells within a radius of a point, closest first
function freeCellsNear(g: Grid, p: Point, radius: number) {
  const centre = toCell(g, p);
  const span = Math.ceil(radius / cell);
  const cells: { c: number; r: number; d: number }[] = [];
  for (let dr = -span; dr <= span; dr++) {
    for (let dc = -span; dc <= span; dc++) {
      const c = centre.c + dc;
      const r = centre.r + dr;
      if (!isFree(g, c, r)) continue;
      const d = distance(toPoint(g, c, r), p);
      if (d <= radius) cells.push({ c, r, d });
    }
  }
  return cells.sort((a, b) => a.d - b.d);
}

// a* over the grid in 8 directions. it may start from any free cell near the person and
// stops at the first free cell close enough to the goal, so a goal squeezed between a wall
// and an obstacle, or a person standing right against a wall, still gets a route
function search(g: Grid, starts: { c: number; r: number; d: number }[], goal: Point, reach: number) {
  const key = (c: number, r: number) => r * g.cols + c;
  const cost = new Float64Array(g.cols * g.rows).fill(Infinity);
  const from = new Int32Array(g.cols * g.rows).fill(-1);
  const closed = new Uint8Array(g.cols * g.rows);
  const open: { k: number; f: number }[] = [];
  const goalCell = toCell(g, goal);
  const h = (c: number, r: number) => {
    const dx = Math.abs(c - goalCell.c);
    const dy = Math.abs(r - goalCell.r);
    return Math.max(dx, dy) + (Math.SQRT2 - 1) * Math.min(dx, dy);
  };
  for (const s of starts) {
    const k = key(s.c, s.r);
    cost[k] = s.d / cell;
    open.push({ k, f: cost[k] + h(s.c, s.r) });
  }

  let found = -1;
  while (open.length) {
    let best = 0;
    for (let i = 1; i < open.length; i++) if (open[i].f < open[best].f) best = i;
    const { k } = open.splice(best, 1)[0];
    if (closed[k]) continue;
    closed[k] = 1;
    const c = k % g.cols;
    const r = Math.floor(k / g.cols);
    if (distance(toPoint(g, c, r), goal) <= reach) {
      found = k;
      break;
    }
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      const nc = c + dc;
      const nr = r + dr;
      if (!isFree(g, nc, nr)) continue;
      // no cutting corners between two blocked cells
      if (dc && dr && (!isFree(g, c + dc, r) || !isFree(g, c, r + dr))) continue;
      const nk = key(nc, nr);
      const next = cost[k] + (dc && dr ? Math.SQRT2 : 1) * weight(g, nc, nr);
      if (next < cost[nk]) {
        cost[nk] = next;
        from[nk] = k;
        open.push({ k: nk, f: next + h(nc, nr) });
      }
    }
  }

  if (found === -1) return null;
  const path: { c: number; r: number }[] = [];
  for (let k = found; k !== -1; k = from[k]) path.unshift({ c: k % g.cols, r: Math.floor(k / g.cols) });
  return path;
}

type Grids = { strict: Grid; relaxed: Grid; ends: Point[] };

// close to where the person starts and to the place itself, walking along a wall is fine,
// so the wall gap is relaxed there. obstacles keep their full clearance everywhere
function lineIsFree(grids: Grids, a: Point, b: Point) {
  const steps = Math.ceil(distance(a, b) / (cell / 2));
  for (let i = 0; i <= steps; i++) {
    const t = steps === 0 ? 0 : i / steps;
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    const g = grids.ends.some((e) => distance(e, p) < 1.2) ? grids.relaxed : grids.strict;
    const { c, r } = toCell(g, p);
    if (!isFree(g, c, r)) return false;
  }
  return true;
}

// what walking a straight line costs: open floor counts more than the strip along a wall
function lineCost(g: Grid, a: Point, b: Point) {
  const steps = Math.max(1, Math.ceil(distance(a, b) / (cell / 2)));
  let total = 0;
  for (let i = 0; i < steps; i++) {
    const t = (i + 0.5) / steps;
    const { c, r } = toCell(g, { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    total += (distance(a, b) / steps) * (isFree(g, c, r) ? weight(g, c, r) : openFloor);
  }
  return total;
}

// keeps only the corners a person has to turn at. a shortcut is taken only when it is free and does not
// cost more than the way it replaces, so a route along a wall is not cut across the open floor
function straighten(g: Grids, points: Point[]) {
  if (points.length < 3) return points;
  const along = [0];
  for (let i = 1; i < points.length; i++) along.push(along[i - 1] + lineCost(g.strict, points[i - 1], points[i]));
  const result = [points[0]];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = points.length - 1;
    while (
      next > anchor + 1 &&
      (!lineIsFree(g, points[anchor], points[next]) || lineCost(g.strict, points[anchor], points[next]) > (along[next] - along[anchor]) * 1.02 + 0.05)
    ) {
      next--;
    }
    result.push(points[next]);
    anchor = next;
  }
  return result;
}

function warningsFor(map: FloorMap, legs: Leg[], goal: Spot) {
  const announced = new Set<string>();
  for (const leg of legs) {
    for (const spot of map.spots) {
      if (spot.id === goal.id || announced.has(spot.id)) continue;
      // a door that swings into this room can hit someone walking past it
      const swinging = spot.kind === "place" && spot.door && spot.opens === "in";
      // stairs to another floor that the way only passes by are as dangerous as stairs in the room
      const stairs = spot.kind === "place" && spot.via === "stairs";
      if (spot.kind !== "obstacle" && !swinging && !stairs) continue;
      const { distance: d, t } = distanceToSegment(spot, leg.from, leg.to);
      const reach = swinging ? 1.5 : warnDistance + (spot.hazard || stairs ? 0.8 : 0);
      if (d - spot.radius > reach || t <= 0 || t >= 1) continue;
      announced.add(spot.id);
      const kind = swinging ? "door" : spot.hazard || stairs ? "hazard" : "pass";
      leg.warnings.push({ spot, side: sideOf(spot, leg.from, leg.to), atMetres: t * leg.metres, kind });
    }
    leg.warnings.sort((a, b) => a.atMetres - b.atMetres);
  }
}

// a stretch follows a wall when most of it runs close to one wall and parallel to it
function wallBeside(map: FloorMap, leg: Leg): WallFollow | null {
  const n = map.outline.length;
  if (n < 3 || leg.metres < 1) return null;
  const samples = Math.max(4, Math.ceil(leg.metres / 0.3));
  const near = new Map<number, number>();
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const p = { x: leg.from.x + (leg.to.x - leg.from.x) * t, y: leg.from.y + (leg.to.y - leg.from.y) * t };
    let best = -1;
    let bestDistance = Infinity;
    for (let j = 0; j < n; j++) {
      const d = distanceToSegment(p, map.outline[j], map.outline[(j + 1) % n]).distance;
      if (d < bestDistance) {
        bestDistance = d;
        best = j;
      }
    }
    if (bestDistance <= caneReach + 0.35) near.set(best, (near.get(best) ?? 0) + 1);
  }
  const [index, count] = [...near].reduce((a, b) => (b[1] > a[1] ? b : a), [-1, 0]);
  if (index < 0 || count < (samples + 1) * 0.6) return null;
  const a = map.outline[index];
  const b = map.outline[(index + 1) % n];
  const angle = Math.abs(turnAngle(leg.heading, headingBetween(a, b)));
  if (angle > 20 && angle < 160) return null;
  const middle = { x: (leg.from.x + leg.to.x) / 2, y: (leg.from.y + leg.to.y) / 2 };
  const { t } = distanceToSegment(middle, a, b);
  const onWall = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  const label = map.walls?.[index];
  return { side: sideOf(onWall, leg.from, leg.to), index, along: label?.along?.trim() || null, glass: Boolean(label?.glass) };
}

// at the end of a stretch along a wall: a door frame or a corner the cane finds
function landmarkAt(map: FloorMap, point: Point): Landmark | null {
  const door = map.spots.find((s, i) => s.kind === "place" && (s.door || i === 0) && distance(s, point) <= 1);
  if (door) return { kind: "door", spot: door };
  if (map.outline.some((corner) => distance(corner, point) <= 1)) return { kind: "corner" };
  return null;
}

export function planPath(map: FloorMap, from: Point, goalId: string, blockedIds: string[] = []): PathPlan {
  const goal = map.spots.find((s) => s.id === goalId && s.kind === "place");
  if (!goal) return { ok: false, reason: "unknown-place" };
  if (blockedIds.includes(goal.id)) return { ok: false, reason: "destination-blocked" };
  if (distance(from, goal) < 0.8) return { ok: false, reason: "already-there" };

  const grid = buildGrid(map, [from, goal]);
  const starts = freeCellsNear(grid, from, 1.2);
  if (starts.length === 0) return { ok: false, reason: "no-path" };
  // try to end right at the place, otherwise as close as the room allows
  let cells: { c: number; r: number }[] | null = null;
  for (const reach of [0.3, 0.8, 1.5]) {
    cells = search(grid, starts, goal, reach);
    if (cells) break;
  }
  if (!cells) return { ok: false, reason: "no-path" };

  const grids: Grids = { strict: grid, relaxed: buildGrid(map, [from, goal], 0.1), ends: [from, goal] };
  const corners = straighten(grids, [from, ...cells.slice(1, -1).map(({ c, r }) => toPoint(grid, c, r)), goal]);
  const legs: Leg[] = [];
  for (let i = 1; i < corners.length; i++) {
    const a = corners[i - 1];
    const b = corners[i];
    const metres = distance(a, b);
    if (metres < 0.3 && legs.length) {
      legs.at(-1)!.to = b;
      continue;
    }
    legs.push({ from: a, to: b, heading: headingBetween(a, b), metres, warnings: [], wall: null, end: null });
  }
  // "walk 1 step" is not a useful instruction: tiny hops, like stepping away from a wall
  // at the start, are folded into the next instruction, a tiny last one into the previous
  for (let i = 0; i < legs.length && legs.length > 1; ) {
    if (distance(legs[i].from, legs[i].to) >= 1) {
      i++;
      continue;
    }
    if (i < legs.length - 1) legs[i + 1].from = legs[i].from;
    else legs[i - 1].to = legs[i].to;
    legs.splice(i, 1);
  }
  for (const leg of legs) {
    leg.metres = distance(leg.from, leg.to);
    leg.heading = headingBetween(leg.from, leg.to);
    leg.wall = wallBeside(map, leg);
    leg.end = leg.wall ? landmarkAt(map, leg.to) : null;
  }
  warningsFor(map, legs, goal);
  return { ok: true, legs, points: corners, goal };
}

// how far from the wall a person walks with the cane touching it
const shoreline = 0.4;

// the walls moved inwards by the shoreline gap: the line a person walks along with the wall beside them
function walkingLine(outline: Point[]): Point[] {
  const n = outline.length;
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  // the inside of the room is on the left of each wall when the outline runs anticlockwise
  const inward = (a: Point, b: Point) => {
    const length = distance(a, b) || 1;
    const dx = (b.x - a.x) / length;
    const dy = (b.y - a.y) / length;
    return area > 0 ? { x: -dy, y: dx } : { x: dy, y: -dx };
  };
  return outline.map((corner, i) => {
    const before = outline[(i - 1 + n) % n];
    const after = outline[(i + 1) % n];
    const n1 = inward(before, corner);
    const n2 = inward(corner, after);
    // where the two walls, each moved inwards, meet
    const sum = { x: n1.x + n2.x, y: n1.y + n2.y };
    const dot = sum.x * n1.x + sum.y * n1.y;
    const scale = dot > 0.2 ? shoreline / dot : shoreline;
    const p = { x: corner.x + sum.x * Math.min(scale, shoreline * 2.5), y: corner.y + sum.y * Math.min(scale, shoreline * 2.5) };
    return pointInPolygon(p, outline) ? p : clampInside(corner, outline, shoreline);
  });
}

// the nearest point of the walking line, as the wall it is on and how far along it
function nearestOnLine(line: Point[], p: Point) {
  let best = { index: 0, t: 0, d: Infinity };
  for (let i = 0; i < line.length; i++) {
    const { distance: d, t } = distanceToSegment(p, line[i], line[(i + 1) % line.length]);
    if (d < best.d) best = { index: i, t, d };
  }
  const a = line[best.index];
  const b = line[(best.index + 1) % line.length];
  return { ...best, point: { x: a.x + (b.x - a.x) * best.t, y: a.y + (b.y - a.y) * best.t } };
}

type Stretch = { from: Point; to: Point; wall: number };

// the stretches from one point of the walking line to another, round the room one way or the other
function aroundRoom(line: Point[], start: ReturnType<typeof nearestOnLine>, end: ReturnType<typeof nearestOnLine>, forward: boolean): Stretch[] {
  const n = line.length;
  const out: Stretch[] = [];
  if (start.index === end.index && (forward ? end.t >= start.t : end.t <= start.t)) return [{ from: start.point, to: end.point, wall: start.index }];
  let at = start.point;
  let wall = start.index;
  for (let guard = 0; guard <= n; guard++) {
    const corner = forward ? line[(wall + 1) % n] : line[wall];
    out.push({ from: at, to: corner, wall });
    at = corner;
    wall = forward ? (wall + 1) % n : (wall - 1 + n) % n;
    if (wall === end.index) break;
  }
  out.push({ from: at, to: end.point, wall: end.index });
  return out;
}

function stretchesLength(stretches: Stretch[]) {
  return stretches.reduce((sum, s) => sum + distance(s.from, s.to), 0);
}

// something standing in the way along the wall costs a detour; stairs beside the wall are kept away from
function detourCost(map: FloorMap, stretches: Stretch[]) {
  let cost = 0;
  for (const o of map.spots) {
    if (o.kind !== "obstacle" || o.hazard === "head") continue;
    const close = Math.min(...stretches.map((s) => distanceToSegment(o, s.from, s.to).distance - o.radius));
    if (o.hazard === "stairs" && close < 0.8) cost += 20;
    else if (close < 0.35) cost += 3;
  }
  return cost;
}

// shorelining: from where the person stands straight to the nearest wall, then along the walls the shorter
// way round, one wall at a time. every corner is felt with the cane and confirmed with a tap, so the
// position is exact again there and errors of the camera or the step counter do not add up
export function planAlongWalls(map: FloorMap, from: Point, goalId: string, blockedIds: string[] = []): PathPlan {
  const goal = map.spots.find((s) => s.id === goalId && s.kind === "place");
  if (!goal) return { ok: false, reason: "unknown-place" };
  if (blockedIds.includes(goal.id)) return { ok: false, reason: "destination-blocked" };
  if (distance(from, goal) < 0.8) return { ok: false, reason: "already-there" };
  if (map.outline.length < 3) return { ok: false, reason: "no-path" };

  const line = walkingLine(map.outline);
  const start = nearestOnLine(line, from);
  const end = nearestOnLine(line, goal);
  const ways = [aroundRoom(line, start, end, true), aroundRoom(line, start, end, false)];
  const [way] = ways.sort((a, b) => stretchesLength(a) + detourCost(map, a) - (stretchesLength(b) + detourCost(map, b)));

  // a point of the outline where the wall goes on straight (the entrance on a wall) is no corner to feel
  const merged: Stretch[] = [];
  for (const s of way) {
    const before = merged.at(-1);
    if (before && Math.abs(turnAngle(headingBetween(before.from, before.to), headingBetween(s.from, s.to))) < 30) {
      if (distance(s.from, s.to) > distance(before.from, before.to)) before.wall = s.wall;
      before.to = s.to;
    } else merged.push({ ...s });
  }
  // tiny bits (a corner right where the person reaches the wall) are not worth an instruction
  const stretches = merged.filter((s) => distance(s.from, s.to) >= 0.3);
  const legs: Leg[] = [];
  const toWall = distance(from, start.point);
  const walls = stretches.length > 0 && stretchesLength(stretches) >= 0.5;
  if (toWall >= 0.5 && walls) {
    legs.push({ from, to: start.point, heading: headingBetween(from, start.point), metres: toWall, warnings: [], wall: null, end: { kind: "wall" } });
  }
  if (walls) {
    stretches.forEach((s, i) => {
      const a = map.outline[s.wall];
      const b = map.outline[(s.wall + 1) % map.outline.length];
      const label = map.walls?.[s.wall];
      const onWall = distanceToSegment({ x: (s.from.x + s.to.x) / 2, y: (s.from.y + s.to.y) / 2 }, a, b);
      const wallPoint = { x: a.x + (b.x - a.x) * onWall.t, y: a.y + (b.y - a.y) * onWall.t };
      const last = i === stretches.length - 1;
      legs.push({
        from: legs.length ? legs.at(-1)!.to : s.from,
        to: s.to,
        heading: headingBetween(s.from, s.to),
        metres: distance(legs.length ? legs.at(-1)!.to : s.from, s.to),
        warnings: [],
        wall: { side: sideOf(wallPoint, s.from, s.to), index: s.wall, along: label?.along?.trim() || null, glass: Boolean(label?.glass) },
        end: last ? landmarkAt(map, s.to) : { kind: "corner" },
      });
    });
  }
  // a place away from the wall: the last few steps leave the wall towards it
  const last = legs.at(-1)?.to ?? from;
  if (distance(last, goal) >= 0.8) {
    legs.push({ from: last, to: goal, heading: headingBetween(last, goal), metres: distance(last, goal), warnings: [], wall: null, end: null });
  } else if (legs.length) {
    legs.at(-1)!.to = { x: goal.x, y: goal.y };
  }
  if (legs.length === 0) return { ok: false, reason: "already-there" };
  for (const leg of legs) {
    leg.metres = distance(leg.from, leg.to);
    leg.heading = headingBetween(leg.from, leg.to);
  }
  warningsFor(map, legs, goal);
  // along a wall, something standing against it is in the way, not beside it
  for (const leg of legs) {
    if (!leg.wall) continue;
    for (const w of leg.warnings) {
      if (w.kind === "pass" && distanceToSegment(w.spot, leg.from, leg.to).distance - w.spot.radius < 0.35) {
        w.kind = "around";
        w.side = leg.wall.side;
      }
    }
  }
  return { ok: true, legs, points: [legs[0].from, ...legs.map((l) => l.to)], goal };
}

export function stepsText(metres: number, stepLength = defaultStepLength) {
  const steps = stepsFor(metres, stepLength);
  return steps === 1 ? "1 step" : `${steps} steps`;
}

// said while passing it: calm, and it tells the person to keep going, never to stop. hazards are said
// plainly, because a cane does not warn about them
export function warningSentence(warning: Warning, stepLength = defaultStepLength, fromMetres = 0) {
  const ahead = warning.atMetres - fromMetres;
  const name = warning.spot.name;
  const where = ahead < 1.2 ? "now" : `in about ${stepsText(ahead, stepLength)}`;
  if (warning.kind === "door") return `Careful: the door ${name} on your ${warning.side} can swing open towards you.`;
  if (warning.kind === "around") {
    const away = warning.side === "left" ? "right" : "left";
    return `${name} stands against the wall ${where}. Step around it on your ${away}, then find the wall again.`;
  }
  if (warning.kind === "hazard") {
    if (warning.spot.hazard === "head") return `Careful: ${name} at head height on your ${warning.side} ${where}, your cane will not find it.`;
    if (warning.spot.hazard === "stairs" || warning.spot.via === "stairs") return `Careful: stairs, ${name}, on your ${warning.side} ${where}. Keep away from them.`;
    return `Careful: ${name} on your ${warning.side} ${where} is glass.`;
  }
  return `${name} on your ${warning.side} ${where}, keep going straight.`;
}

export function wallName(wall: WallFollow) {
  if (wall.along) return wall.along.toLowerCase();
  return wall.glass ? "glass wall" : "wall";
}

function landmarkText(end: Landmark) {
  if (end.kind === "corner") return "reach the corner";
  if (end.kind === "wall") return "touch the wall";
  return `feel the door frame of ${end.spot.name}`;
}

// a stretch along a wall ending at a corner or a door is finished by the person, who can feel it,
// not by the step counter: the position is exact again there
export function isCheckpoint(leg: Leg, last: boolean) {
  return Boolean(leg.end && !last && (leg.wall || leg.end.kind === "wall"));
}

// one instruction at a time: the turn, how far, what to watch out for
export function turnFor(facing: number | null, heading: number) {
  if (facing === null) return null;
  const angle = turnAngle(facing, heading);
  if (Math.abs(angle) >= 10 && Math.abs(angle) < 25) return `Bear slightly ${angle > 0 ? "right" : "left"}.`;
  return describeTurn(angle);
}

// the facts of one stretch, also what the ai is given to put into its own words
export function legFacts(
  leg: Leg,
  facing: number | null,
  last: boolean,
  destination: string,
  previous: Leg | null,
  next: Leg | null,
  map: FloorMap | null = null,
) {
  // stepping off a wall because something stands against it: the obstacle is beside the wall just left
  const blocked =
    !leg.wall && previous?.wall
      ? (leg.warnings.find((w) => {
          if (w.kind === "door" || w.spot.hazard === "head") return false;
          if (next?.wall?.index === previous.wall!.index) return true;
          if (!map) return false;
          const a = map.outline[previous.wall!.index];
          const b = map.outline[(previous.wall!.index + 1) % map.outline.length];
          return distanceToSegment(w.spot, a, b).distance - w.spot.radius <= 0.8;
        })?.spot ?? null)
      : null;
  return {
    turn: turnFor(facing, leg.heading),
    leaveWall: Boolean(previous?.wall && !leg.wall),
    wall: leg.wall,
    end: leg.end,
    blocked,
    warnings: leg.warnings.filter((w) => w.spot !== blocked),
    destination: last ? destination : null,
    checkpoint: isCheckpoint(leg, last),
    toWall: !leg.wall && !blocked && next?.wall ? next.wall : null,
  };
}

export function legSentence(
  leg: Leg,
  facing: number | null,
  last: boolean,
  destination: string,
  stepLength = defaultStepLength,
  previous: Leg | null = null,
  next: Leg | null = null,
  map: FloorMap | null = null,
) {
  const facts = legFacts(leg, facing, last, destination, previous, next, map);
  const steps = stepsText(leg.metres, stepLength);
  const parts: (string | null)[] = [];
  if (facts.leaveWall && !facts.blocked) parts.push("Leave the wall here.");
  parts.push(facts.turn);
  if (facts.blocked && previous?.wall) {
    // the wall is lined by something in the way: around it on the side away from the wall, then back
    const away = previous.wall.side === "left" ? "right" : "left";
    parts.push(`The ${wallName(previous.wall)} is blocked by ${facts.blocked.name}, step around it on your ${away}, about ${steps}, then find the ${wallName(previous.wall)} again.`);
  } else if (facts.wall) {
    const until = facts.end && !last ? ` until you ${landmarkText(facts.end)}` : "";
    parts.push(`Keep the ${wallName(facts.wall)} on your ${facts.wall.side}${until}, about ${steps}.`);
  } else if (facts.toWall) {
    parts.push(`Walk about ${steps}${facts.turn ? "" : " straight ahead"} until you reach the ${wallName(facts.toWall)}.`);
  } else {
    parts.push(`Walk about ${steps}${facts.turn ? "" : " straight ahead"}.`);
  }
  const passing = facts.warnings.filter((w) => w.kind === "pass");
  const careful = facts.warnings.filter((w) => w.kind !== "pass");
  if (passing[0]) parts.push(`You will pass ${passing[0].spot.name} on your ${passing[0].side}${passing[1] ? `, then ${passing[1].spot.name} on your ${passing[1].side}` : ""}.`);
  for (const w of careful) parts.push(warningSentence(w, stepLength, -10).replace(/ in about \d+ steps?/, ""));
  if (facts.destination) parts.push(`${facts.destination} will be in front of you.`);
  if (facts.checkpoint) parts.push("Then tap the top half.");
  return parts.filter(Boolean).join(" ");
}

// where someone stands, said by what they can feel: a place close by, the nearest wall, or the open
// middle of the room. walls are numbered as on the review screen, the side is from where the person faces
export function describePosition(map: FloorMap, position: Point, facing: number | null, nearSpotId: string | null = null, stepLength = defaultStepLength) {
  const n = map.outline.length;
  let wall = { index: -1, d: Infinity, point: position };
  for (let i = 0; i < n; i++) {
    const a = map.outline[i];
    const b = map.outline[(i + 1) % n];
    const { distance: d, t } = distanceToSegment(position, a, b);
    if (d < wall.d) wall = { index: i, d, point: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } };
  }
  const place =
    map.spots.find((s) => s.id === nearSpotId && distance(s, position) < 1.5) ??
    map.spots.filter((s) => s.kind === "place" && distance(s, position) < 1.2).sort((a, b) => distance(a, position) - distance(b, position))[0];
  if (wall.index < 0) return place ? `You are near ${place.name}.` : "I found where you are.";
  const along = map.walls?.[wall.index]?.along?.trim();
  const name = `wall ${wall.index + 1}${along ? `, with the ${along.toLowerCase()}` : ""}`;
  const turn = facing === null ? null : turnAngle(facing, headingBetween(position, wall.point));
  const side = turn === null ? "" : Math.abs(turn) < 45 ? " in front of you" : Math.abs(turn) > 135 ? " behind you" : turn > 0 ? " on your right" : " on your left";
  if (place) return `You are near ${place.name}${wall.d <= 1 ? `, next to ${name}${side}` : ""}.`;
  if (wall.d <= 1.2) return `You are next to ${name}${side}.`;
  if (wall.d >= 1.8) return `You are in the middle of the room. The nearest wall is ${name}, about ${stepsText(wall.d, stepLength)}${side}.`;
  return `The nearest wall is ${name}, about ${stepsText(wall.d, stepLength)}${side}.`;
}

export function whereAmI(map: FloorMap, position: Point, goal: Spot | null, facing: number | null, stepLength = defaultStepLength) {
  const nearest = [...map.spots].sort((a, b) => distance(a, position) - distance(b, position))[0];
  const parts: string[] = [];
  if (nearest) {
    const d = distance(nearest, position);
    if (d < 1) parts.push(`You are next to ${nearest.name}.`);
    else {
      const turn = facing === null ? 0 : turnAngle(facing, headingBetween(position, nearest));
      const where = Math.abs(turn) < 45 ? "ahead of you" : Math.abs(turn) > 135 ? "behind you" : turn > 0 ? "on your right" : "on your left";
      parts.push(`${nearest.name} is about ${stepsText(d, stepLength)} ${where}.`);
    }
  }
  if (goal && nearest?.id !== goal.id) parts.push(`${goal.name} is about ${stepsText(distance(goal, position), stepLength)} away.`);
  if (!pointInPolygon(position, map.outline)) parts.push("You may be outside the mapped room.");
  return parts.join(" ");
}
