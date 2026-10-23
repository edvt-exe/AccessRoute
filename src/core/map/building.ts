import { distance, distanceToSegment, headingBetween, pointInPolygon } from "./geometry";
import type { DoorRef, FloorMap, Point, Spot, Stairs } from "./types";
import { normalizeHeading } from "./walking";

// rooms are joined by doors: a door place in one room that leads to a place in another room.
// a link counts when it is set on either side and both rooms are known
export type DoorLink = { a: { map: FloorMap; spot: Spot }; b: { map: FloorMap; spot: Spot } };

export function doorLinks(maps: FloorMap[]): DoorLink[] {
  const byId = new Map(maps.map((m) => [m.id, m]));
  const seen = new Set<string>();
  const links: DoorLink[] = [];
  for (const map of maps) {
    for (const spot of map.spots) {
      if (spot.kind !== "place" || !spot.leadsTo) continue;
      const other = byId.get(spot.leadsTo.mapId);
      const target = other?.spots.find((s) => s.id === spot.leadsTo!.spotId && s.kind === "place");
      if (!other || !target || other.id === map.id) continue;
      const key = [`${map.id}/${spot.id}`, `${other.id}/${target.id}`].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      links.push({ a: { map, spot }, b: { map: other, spot: target } });
    }
  }
  return links;
}

// a lift or stairs: a door that leads to another floor
export function changesFloor(spot: Spot) {
  return spot.via === "lift" || spot.via === "stairs";
}

// how the floor of a map is said: "floor 2", "ground floor", or the room's name when it was not set
export function floorName(map: FloorMap) {
  const floor = map.floor?.trim();
  if (!floor) return `the floor of ${map.name}`;
  return /^-?\d+$/.test(floor) ? `floor ${floor}` : floor;
}

// the same stairs seen from the other end: the other way, the handrail on the other hand
export function otherEnd(stairs: Stairs): Stairs {
  const handrail = stairs.handrail === "left" ? "right" : stairs.handrail === "right" ? "left" : stairs.handrail;
  return { steps: stairs.steps, going: stairs.going === "up" ? "down" : "up", handrail };
}

export type Hop = { from: DoorRef; to: DoorRef }; // walk to `from`, go through, arrive at `to`

const crossing = 1; // metres a door is worth, so a route never hops through rooms for nothing

// which doors to go through, shortest walk first. inside a room the distance is measured in a
// straight line, the real path around the furniture is planned later, room by room
export function roomRoute(maps: FloorMap[], from: { mapId: string; point: Point }, to: DoorRef): Hop[] | null {
  if (from.mapId === to.mapId) return [];
  const links = doorLinks(maps);
  type Node = { key: string; mapId: string; point: Point; ref?: DoorRef };
  const nodes: Node[] = [{ key: "start", mapId: from.mapId, point: from.point }];
  for (const { a, b } of links) {
    for (const side of [a, b]) nodes.push({ key: `${side.map.id}/${side.spot.id}`, mapId: side.map.id, point: side.spot, ref: { mapId: side.map.id, spotId: side.spot.id } });
  }
  const goalMap = maps.find((m) => m.id === to.mapId);
  const goal = goalMap?.spots.find((s) => s.id === to.spotId);
  if (!goal) return null;
  nodes.push({ key: "goal", mapId: to.mapId, point: goal });

  const partner = new Map<string, string>();
  for (const { a, b } of links) {
    partner.set(`${a.map.id}/${a.spot.id}`, `${b.map.id}/${b.spot.id}`);
    partner.set(`${b.map.id}/${b.spot.id}`, `${a.map.id}/${a.spot.id}`);
  }
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const cost = new Map<string, number>([["start", 0]]);
  const previous = new Map<string, string>();
  const done = new Set<string>();

  while (true) {
    let current: Node | null = null;
    for (const node of nodes) {
      if (done.has(node.key) || !cost.has(node.key)) continue;
      if (!current || cost.get(node.key)! < cost.get(current.key)!) current = node;
    }
    if (!current) return null;
    if (current.key === "goal") break;
    done.add(current.key);
    const here = cost.get(current.key)!;
    const next: [string, number][] = nodes.filter((n) => n.mapId === current!.mapId && n.key !== current!.key).map((n) => [n.key, distance(current!.point, n.point)]);
    const through = partner.get(current.key);
    if (through) next.push([through, crossing]);
    for (const [key, step] of next) {
      if (done.has(key)) continue;
      if (here + step < (cost.get(key) ?? Infinity)) {
        cost.set(key, here + step);
        previous.set(key, current.key);
      }
    }
  }

  const path: string[] = [];
  for (let key: string | undefined = "goal"; key; key = previous.get(key)) path.unshift(key);
  const hops: Hop[] = [];
  for (let i = 0; i + 1 < path.length; i++) {
    const a = byKey.get(path[i])!;
    const b = byKey.get(path[i + 1])!;
    if (a.ref && b.ref && a.mapId !== b.mapId) hops.push({ from: a.ref, to: b.ref });
  }
  return hops;
}

// the way out of a room through a door. a door place is recorded facing the door; the entrance is
// recorded facing into the room, so out through the entrance is straight back
export function doorOut(map: FloorMap, spot: Spot) {
  if (spot.id === map.spots[0]?.id) return 180;
  return spot.heading ?? 180;
}

// where a person stands right after going through a door into this room: a step past the door,
// facing into the room
export function afterDoor(map: FloorMap, spot: Spot, metres = 0.7) {
  const facing = normalizeHeading(doorOut(map, spot) + 180);
  const rad = (facing * Math.PI) / 180;
  return { point: { x: spot.x + Math.sin(rad) * metres, y: spot.y + Math.cos(rad) * metres }, facing };
}

export type Placement = { rotation: number; dx: number; dy: number };

export function place(p: Point, t: Placement): Point {
  const r = (t.rotation * Math.PI) / 180;
  return { x: p.x * Math.cos(r) + p.y * Math.sin(r) + t.dx, y: -p.x * Math.sin(r) + p.y * Math.cos(r) + t.dy };
}

// the general map: rooms joined by a door are turned and moved so the two sides of the door meet and
// face each other. rooms that are not joined to anything are laid next to the rest
export function buildingLayout(maps: FloorMap[]) {
  // rooms on another floor are not laid against this one, they are drawn next to it
  const links = doorLinks(maps).filter(({ a, b }) => !changesFloor(a.spot) && !changesFloor(b.spot));
  const placed = new Map<string, Placement>();
  const gap = 2;

  for (const root of maps) {
    if (placed.has(root.id)) continue;
    const right = placed.size
      ? Math.max(...[...placed].flatMap(([id, t]) => maps.find((m) => m.id === id)!.outline.map((p) => place(p, t).x)))
      : 0;
    const left = Math.min(...root.outline.map((p) => p.x), 0);
    placed.set(root.id, { rotation: 0, dx: placed.size ? right + gap - left : 0, dy: 0 });
    const queue = [root.id];
    while (queue.length) {
      const id = queue.shift()!;
      const t = placed.get(id)!;
      for (const { a, b } of links) {
        const [here, there] = a.map.id === id ? [a, b] : b.map.id === id ? [b, a] : [null, null];
        if (!here || !there || placed.has(there.map.id)) continue;
        // the two walls that hold the door are laid against each other: parallel, facing opposite ways
        const out = wallOut(here.map, here.spot) + t.rotation;
        const rotation = normalizeHeading(out + 180 - wallOut(there.map, there.spot));
        // the door place stands a little in front of the wall, the rooms meet at the walls themselves
        const door = place(onWall(here.spot, here.map.outline), t);
        const turned = place(onWall(there.spot, there.map.outline), { rotation, dx: 0, dy: 0 });
        placed.set(there.map.id, { rotation, dx: door.x - turned.x, dy: door.y - turned.y });
        queue.push(there.map.id);
      }
    }
  }
  return placed;
}

// the closest point on the walls, where a door really is
export function onWall(point: Point, outline: Point[]): Point {
  let best = point;
  let bestDistance = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    const { distance: d, t } = distanceToSegment(point, a, b);
    if (d < bestDistance) {
      bestDistance = d;
      best = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
  }
  return best;
}

// the direction straight out of the room through the wall that holds the door. it comes from the drawn wall,
// not from the phone, so joined rooms line up exactly. a room without walls falls back to the recorded direction
export function wallOut(map: FloorMap, spot: Spot) {
  const outline = map.outline;
  if (outline.length < 3) return doorOut(map, spot);
  let wall = 0;
  let best = Infinity;
  for (let i = 0; i < outline.length; i++) {
    const d = distanceToSegment(spot, outline[i], outline[(i + 1) % outline.length]).distance;
    if (d < best) {
      best = d;
      wall = i;
    }
  }
  const a = outline[wall];
  const b = outline[(wall + 1) % outline.length];
  const along = headingBetween(a, b);
  const middle = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  for (const normal of [along + 90, along - 90]) {
    const r = (normal * Math.PI) / 180;
    const probe = { x: middle.x + Math.sin(r) * 0.05, y: middle.y + Math.cos(r) * 0.05 };
    if (!pointInPolygon(probe, outline)) return normalizeHeading(normal);
  }
  return doorOut(map, spot);
}
