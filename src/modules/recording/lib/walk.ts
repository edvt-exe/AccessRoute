import { advance, closeLoop, round, type Point, type Spot } from "@/core/map";

export function newMapId(name: string) {
  const slug = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
  return `${slug || "room"}-${Math.random().toString(36).slice(2, 7)}`;
}

export const obstacleSizes = {
  small: { label: "Small, like a plant or a bin", radius: 0.3 },
  medium: { label: "Medium, like a table or a sofa", radius: 0.6 },
  large: { label: "Large, like a pillar or a counter", radius: 1 },
} as const;

export type ObstacleSize = keyof typeof obstacleSizes;

// the recorder stands in front of the thing, facing it, so it is a little ahead of them
export function spotPosition(position: Point, heading: number | null, kind: Spot["kind"], radius: number) {
  if (heading === null) return round(position);
  return round(advance(position, heading, kind === "obstacle" ? 0.4 + radius : 0.5));
}

export type PendingSpot = Spot & { walkIndex: number };

// when the recorder is back at the entrance, the drift of the walk since the last visit is spread
// over that part of the walk, and every spot added on the way moves with it
export function reanchor<T extends Point & { walkIndex: number }>(walked: Point[], from: number, spots: T[]) {
  const part = walked.slice(from);
  if (part.length < 2) return { walked, spots, error: 0 };
  const { points, error } = closeLoop(part, { x: 0, y: 0 });
  const nextWalked = [...walked.slice(0, from), ...points.map(round)];
  const nextSpots = spots.map((spot) => {
    if (spot.walkIndex < from || spot.walkIndex >= walked.length) return spot;
    const k = spot.walkIndex - from;
    const shift = { x: points[k].x - part[k].x, y: points[k].y - part[k].y };
    return { ...spot, ...round({ x: spot.x + shift.x, y: spot.y + shift.y }) };
  });
  return { walked: nextWalked, spots: nextSpots, error };
}

// at most this many items, spread evenly over the list
export function thin<T>(items: T[], max: number) {
  if (items.length <= max) return items;
  return Array.from({ length: max }, (_, i) => items[Math.round((i * (items.length - 1)) / (max - 1))]);
}

export const viewEvery = { walls: 4, spots: 3 }; // steps between two automatic photos
export const maxViews = { walls: 30, spots: 30, corners: 20 };
