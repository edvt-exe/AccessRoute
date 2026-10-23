import { describe, expect, it } from "vitest";
import type { FloorMap, Spot } from "@/core/map";
import { legSentence, planPath, whereAmI } from "./plan";

const spot = (id: string, kind: Spot["kind"], name: string, x: number, y: number, radius = 0): Spot => ({
  id, kind, name, x, y, radius, heading: 0, photo: "data:image/jpeg;base64,", thumb: "data:image/jpeg;base64,", videoTime: 0,
});

// a 6 x 8 m room, entrance in the middle of the bottom wall, sofa in the middle
const room: FloorMap = {
  id: "room-1", name: "Office", status: "published", createdBy: "", createdAt: "", updatedAt: "", videoUrl: null,
  outline: [{ x: -3, y: 0 }, { x: -3, y: 8 }, { x: 3, y: 8 }, { x: 3, y: 0 }],
  spots: [
    spot("e", "place", "Entrance", 0, 0),
    spot("k", "place", "Kitchen", 0, 7.5),
    spot("w", "place", "Window", 2.5, 4),
    spot("sofa", "obstacle", "Sofa", 0, 4, 0.8),
    spot("plant", "obstacle", "Plant", 2.4, 1.5, 0.3),
  ],
  walked: [], closureError: 0, version: 1,
};

describe("planPath", () => {
  it("goes around the sofa instead of through it", () => {
    const plan = planPath(room, { x: 0, y: 0 }, "k");
    expect(plan.ok).toBe(true);
    if (!plan.ok) return;
    for (const p of plan.points) expect(Math.hypot(p.x - 0, p.y - 4)).toBeGreaterThan(0.8);
    expect(plan.legs.length).toBeGreaterThanOrEqual(2);
    expect(plan.legs.length).toBeLessThanOrEqual(4);
  });

  it("is not much longer than the shortest way, even keeping to the walls", () => {
    const plan = planPath(room, { x: 0, y: 0 }, "k");
    if (!plan.ok) throw new Error("no plan");
    const length = plan.legs.reduce((s, l) => s + l.metres, 0);
    expect(length).toBeLessThan(12); // straight through would be 7.5 m
  });

  it("crosses the open floor to a place in the middle of the room", () => {
    const middle = { ...room, spots: [room.spots[0], spot("t", "place", "Table", 0, 2.5)] };
    const plan = planPath(middle, { x: 0, y: 0 }, "t");
    if (!plan.ok) throw new Error("no plan");
    expect(plan.legs).toHaveLength(1);
  });

  it("still reaches a place squeezed between a corner and an obstacle", () => {
    const squeezed = { ...room, spots: [...room.spots, spot("cupboard", "place", "Cupboard", 2.8, 7.8), spot("bin", "obstacle", "Bin", 2.3, 7.6, 0.3)] };
    const plan = planPath(squeezed, { x: 0, y: 0 }, "cupboard");
    expect(plan.ok).toBe(true);
  });

  it("starts even when the person stands against a wall", () => {
    const plan = planPath(room, { x: -2.95, y: 3 }, "w");
    expect(plan.ok).toBe(true);
  });

  it("refuses a place reported as broken and knows when you are there", () => {
    expect(planPath(room, { x: 0, y: 0 }, "k", ["k"])).toEqual({ ok: false, reason: "destination-blocked" });
    expect(planPath(room, { x: 0, y: 7.3 }, "k")).toEqual({ ok: false, reason: "already-there" });
  });
});

describe("sentences", () => {
  it("gives one instruction with the turn and the steps", () => {
    const middle = { ...room, spots: [room.spots[0], spot("t", "place", "Table", 1.5, 2.5)] };
    const plan = planPath(middle, { x: 0, y: 0 }, "t");
    if (!plan.ok) throw new Error("no plan");
    expect(legSentence(plan.legs[0], 0, true, "Table")).toMatch(/^(Bear|Turn) slightly right\. Walk about \d+ steps\. Table will be in front of you\.$/);
  });

  it("tells where you are from the measured position", () => {
    expect(whereAmI(room, { x: 0, y: 2.5 }, room.spots[1], 0)).toBe("Sofa is about 2 steps ahead of you. Kitchen is about 7 steps away.");
  });
});

// the kitchen is in the far left corner; a cabinet stands against the left wall half way
const corner: FloorMap = {
  ...room,
  spots: [
    spot("e", "place", "Entrance", 0, 0),
    spot("k", "place", "Kitchen", -2.4, 7.4),
    spot("cab", "obstacle", "Cabinet", -2.6, 4, 0.4),
  ],
};

function sentences(map: FloorMap, goal: string) {
  const plan = planPath(map, { x: 0, y: 0 }, goal);
  if (!plan.ok) throw new Error("no plan");
  let facing = 0;
  return plan.legs.map((leg, i) => {
    const text = legSentence(leg, facing, i === plan.legs.length - 1, "Kitchen", 0.7, plan.legs[i - 1] ?? null, plan.legs[i + 1] ?? null, map);
    facing = leg.heading;
    return text;
  });
}

describe("routes along the walls", () => {
  it("keeps the wall on one side, so a cane can follow it", () => {
    expect(sentences(corner, "k").join(" ")).toMatch(/Keep the wall on your (left|right)/);
  });

  it("says when something against the wall is in the way and how to get round it", () => {
    expect(sentences(corner, "k").join(" ")).toMatch(/blocked by Cabinet, step around it on your right, about \d+ steps?, then find the wall again/);
  });

  it("says what lines a wall when the recorder walked past furniture there", () => {
    const sofa = { ...corner, walls: [{ along: "Sofa" }] };
    expect(sentences(sofa, "k").join(" ")).toMatch(/Keep the sofa on your/);
  });

  it("warns plainly about something at head height that a cane will not find", () => {
    const shelf = { ...corner, spots: [...corner.spots, { ...spot("shelf", "obstacle", "Shelf", -0.6, 6, 0.2), hazard: "head" as const }] };
    expect(sentences(shelf, "k").join(" ")).toMatch(/Shelf at head height .*your cane will not find it/);
  });

  it("warns about a door that can swing open towards the person", () => {
    const door = { ...corner, spots: [...corner.spots, { ...spot("d", "place", "Store room", -2.9, 2.6), door: true, opens: "in" as const }] };
    expect(sentences(door, "k").join(" ")).toMatch(/the door Store room on your left can swing open towards you/);
  });
});
