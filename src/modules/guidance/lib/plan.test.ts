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

  it("is close to the shortest possible way", () => {
    const plan = planPath(room, { x: 0, y: 0 }, "k");
    if (!plan.ok) throw new Error("no plan");
    const length = plan.legs.reduce((s, l) => s + l.metres, 0);
    expect(length).toBeLessThan(9.5); // straight through would be 7.5 m
  });

  it("walks straight when nothing is in the way", () => {
    const plan = planPath(room, { x: 0, y: 0 }, "w");
    if (!plan.ok) throw new Error("no plan");
    expect(plan.legs).toHaveLength(1);
  });

  it("warns about the sofa on the way and says on which side", () => {
    const plan = planPath(room, { x: 0, y: 0 }, "k");
    if (!plan.ok) throw new Error("no plan");
    const warnings = plan.legs.flatMap((l) => l.warnings);
    expect(warnings.map((w) => w.spot.name)).toContain("Sofa");
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
    const plan = planPath(room, { x: 0, y: 0 }, "w");
    if (!plan.ok) throw new Error("no plan");
    expect(legSentence(plan.legs[0], 0, true, "Window")).toMatch(/^Turn (slightly )?right\. Walk about \d+ steps\. .*Window will be in front of you\.$/);
  });

  it("tells where you are from the measured position", () => {
    expect(whereAmI(room, { x: 0, y: 2.5 }, room.spots[1], 0)).toBe("Sofa is about 2 steps ahead of you. Kitchen is about 7 steps away.");
  });
});
