import { describe, expect, it } from "vitest";
import type { Spot } from "@/core/map";
import { reanchor, spotPosition } from "./walk";

const spot = (id: string, x: number, y: number, walkIndex: number) =>
  ({ id, kind: "place", name: id, x, y, radius: 0, heading: 0, photo: "", thumb: "", videoTime: 0, walkIndex }) as Spot & { walkIndex: number };

describe("spotPosition", () => {
  it("puts a place half a metre in front of the recorder", () => {
    expect(spotPosition({ x: 1, y: 1 }, 90, "place", 0)).toEqual({ x: 1.5, y: 1 });
  });
  it("puts an obstacle further away, by its size", () => {
    expect(spotPosition({ x: 0, y: 0 }, 0, "obstacle", 0.6)).toEqual({ x: 0, y: 1 });
  });
});

describe("reanchor", () => {
  it("pulls the walk and its spots back so the walk ends at the entrance", () => {
    // walked 4 m forward and 4 m back, but the sensors say the end is 1 m to the right
    const walked = [0, 1, 2, 3, 4, 3, 2, 1, 0].map((y, i) => ({ x: i * 0.125, y }));
    const spots = [spot("kitchen", 0.5, 4, 4)];
    const result = reanchor(walked, 0, spots);
    expect(result.error).toBeCloseTo(1);
    expect(result.walked.at(-1)).toEqual({ x: 0, y: 0 });
    expect(result.spots[0].x).toBeCloseTo(0);
  });
});
