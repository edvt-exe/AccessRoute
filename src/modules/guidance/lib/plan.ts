import {
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

export type Warning = { spot: Spot; side: "left" | "right"; atMetres: number };

export type Leg = {
  from: Point;
  to: Point;
  heading: number;
  metres: number;
  warnings: Warning[];
};

export type PathPlan =
  | { ok: true; legs: Leg[]; points: Point[]; goal: Spot }
  | { ok: false; reason: "unknown-place" | "destination-blocked" | "no-path" | "already-there" };

type Grid = {
  free: Uint8Array;
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
  const obstacles = map.spots.filter((s) => s.kind === "obstacle");

  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const p = { x: originX + c * cell, y: originY + r * cell };
      const nearKept = keepFree.some((k) => distance(k, p) < 0.6);
      if (!pointInPolygon(p, map.outline) && !nearKept) continue;
      if (!nearKept && distanceToOutline(p, map.outline) < wallGap) continue;
      if (obstacles.some((o) => distance(o, p) < o.radius + obstacleClearance)) continue;
      free[r * cols + c] = 1;
    }
  }
  return { free, cols, rows, originX, originY };
}

const toCell = (g: Grid, p: Point) => ({ c: Math.round((p.x - g.originX) / cell), r: Math.round((p.y - g.originY) / cell) });
const toPoint = (g: Grid, c: number, r: number) => ({ x: g.originX + c * cell, y: g.originY + r * cell });
const isFree = (g: Grid, c: number, r: number) => c >= 0 && r >= 0 && c < g.cols && r < g.rows && g.free[r * g.cols + c] === 1;

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
      const next = cost[k] + (dc && dr ? Math.SQRT2 : 1);
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

// keeps only the corners a person actually has to turn at
function straighten(g: Grids, points: Point[]) {
  if (points.length < 3) return points;
  const result = [points[0]];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = points.length - 1;
    while (next > anchor + 1 && !lineIsFree(g, points[anchor], points[next])) next--;
    result.push(points[next]);
    anchor = next;
  }
  return result;
}

function warningsFor(map: FloorMap, legs: Leg[], goal: Spot) {
  const announced = new Set<string>();
  for (const leg of legs) {
    for (const spot of map.spots) {
      if (spot.kind !== "obstacle" || spot.id === goal.id || announced.has(spot.id)) continue;
      const { distance: d, t } = distanceToSegment(spot, leg.from, leg.to);
      if (d - spot.radius > warnDistance || t <= 0 || t >= 1) continue;
      announced.add(spot.id);
      leg.warnings.push({ spot, side: sideOf(spot, leg.from, leg.to), atMetres: t * leg.metres });
    }
    leg.warnings.sort((a, b) => a.atMetres - b.atMetres);
  }
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
    legs.push({ from: a, to: b, heading: headingBetween(a, b), metres, warnings: [] });
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
  }
  warningsFor(map, legs, goal);
  return { ok: true, legs, points: corners, goal };
}

export function stepsText(metres: number, stepLength = defaultStepLength) {
  const steps = stepsFor(metres, stepLength);
  return steps === 1 ? "1 step" : `${steps} steps`;
}

export function warningSentence(warning: Warning, stepLength = defaultStepLength, fromMetres = 0) {
  const ahead = warning.atMetres - fromMetres;
  const when = ahead < 1 ? "right now" : `in about ${stepsText(ahead, stepLength)}`;
  return `Careful: ${warning.spot.name} on your ${warning.side}, ${when}.`;
}

// one instruction at a time: the turn, how far, what to watch out for
export function turnFor(facing: number | null, heading: number) {
  if (facing === null) return null;
  const angle = turnAngle(facing, heading);
  if (Math.abs(angle) >= 10 && Math.abs(angle) < 25) return `Bear slightly ${angle > 0 ? "right" : "left"}.`;
  return describeTurn(angle);
}

export function legSentence(leg: Leg, facing: number | null, last: boolean, destination: string, stepLength = defaultStepLength) {
  const turn = turnFor(facing, leg.heading);
  const parts = [turn, `Walk about ${stepsText(leg.metres, stepLength)}${turn ? "" : " straight ahead"}.`];
  const first = leg.warnings[0];
  if (first) parts.push(`You will pass ${first.spot.name} on your ${first.side}.`);
  if (last) parts.push(`${destination} will be in front of you.`);
  return parts.filter(Boolean).join(" ");
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
