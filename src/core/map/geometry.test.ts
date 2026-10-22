import { describe, expect, it } from "vitest";
import { clampInside, closeLoop, distance, pointAlongOutline, setWallLength, outlineFromCorners, outlineFromSteps, pointInPolygon, runsFromSteps, sideOf, snapHeading } from "./geometry";

const steps = (heading: number, count: number) => Array(count).fill(heading);
const noisy = (list: number[]) => list.map((h, i) => (h + ((i * 7) % 13) - 6 + 360) % 360);

describe("snapHeading", () => {
  it("straightens directions close to the room axes", () => {
    expect(snapHeading(8)).toBe(0);
    expect(snapHeading(352)).toBe(0);
    expect(snapHeading(97)).toBe(90);
    expect(snapHeading(45)).toBe(45);
  });
});

describe("outlineFromSteps", () => {
  it("turns a noisy walk around a 7 x 5 m room into a closed rectangle", () => {
    // 10 steps forward, right, 7 steps, right, 10 steps, right, 7 steps back to the entrance
    const walk = noisy([...steps(0, 10), ...steps(90, 7), ...steps(180, 10), ...steps(270, 7)]);
    const { outline, closureError } = outlineFromSteps(walk, 0.7);
    expect(outline).toHaveLength(4);
    expect(outline[0]).toEqual({ x: 0, y: 0 });
    expect(outline[1]).toEqual({ x: 0, y: 7 });
    expect(outline[2]).toEqual({ x: 4.9, y: 7 });
    expect(outline[3]).toEqual({ x: 4.9, y: 0 });
    expect(closureError).toBe(0);
  });

  it("spreads the error when the walk does not end exactly at the start", () => {
    const walk = [...steps(0, 10), ...steps(90, 7), ...steps(180, 9), ...steps(270, 7)];
    const { outline, closureError } = outlineFromSteps(walk, 1);
    expect(closureError).toBeCloseTo(1);
    expect(outline[2].y).toBeGreaterThan(9);
  });

  it("ignores a single wobbly step", () => {
    expect(runsFromSteps([...steps(0, 5), 90, ...steps(0, 5)])).toEqual([{ heading: 0, steps: 11 }]);
  });

  it("ignores a short detour around a chair", () => {
    expect(runsFromSteps([...steps(0, 6), 90, 90, 0, 270, 270, ...steps(0, 6)])).toEqual([{ heading: 0, steps: 17 }]);
  });
});

describe("outline under real sensor problems", () => {
  // the gyroscope slowly turns: by the end of the lap it is off by `total` degrees
  const drifting = (list: number[], total: number) => list.map((h, i) => (h + (total * i) / list.length + 360) % 360);

  it("keeps a rectangle rectangular when the gyroscope drifts 40 degrees over the lap", () => {
    const walk = noisy(drifting([...steps(0, 10), ...steps(90, 7), ...steps(180, 10), ...steps(270, 7)], 40));
    const { outline } = outlineFromSteps(walk, 0.7);
    expect(outline).toEqual([{ x: 0, y: 0 }, { x: 0, y: 7 }, { x: 4.9, y: 7 }, { x: 4.9, y: 0 }]);
  });

  it("keeps right angles when the step counter misses steps on one wall", () => {
    // the far wall counted 8 steps instead of 10, opposite walls are evened out
    const { outline } = outlineFromSteps([...steps(0, 10), ...steps(90, 7), ...steps(180, 8), ...steps(270, 7)], 1);
    expect(outline).toEqual([{ x: 0, y: 0 }, { x: 0, y: 9 }, { x: 7, y: 9 }, { x: 7, y: 0 }]);
  });

  it("draws an L shaped room", () => {
    const walk = noisy([...steps(0, 8), ...steps(90, 4), ...steps(180, 4), ...steps(90, 4), ...steps(180, 4), ...steps(270, 8)]);
    const { outline } = outlineFromSteps(walk, 1);
    expect(outline).toEqual([{ x: 0, y: 0 }, { x: 0, y: 8 }, { x: 4, y: 8 }, { x: 4, y: 4 }, { x: 8, y: 4 }, { x: 8, y: 0 }]);
  });

  it("works when the walk starts along the entrance wall instead of into the room", () => {
    const walk = noisy([...steps(90, 6), ...steps(0, 5), ...steps(270, 6), ...steps(180, 5)]);
    const { outline } = outlineFromSteps(walk, 1);
    expect(outline).toEqual([{ x: 0, y: 0 }, { x: 6, y: 0 }, { x: 6, y: 5 }, { x: 0, y: 5 }]);
  });

  it("keeps right angles even when a turn was measured half way", () => {
    const { outline } = outlineFromSteps([...steps(0, 6), ...steps(45, 4), ...steps(90, 3), ...steps(180, 9), ...steps(270, 6)], 1);
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      expect(Math.min(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeLessThan(0.01);
    }
  });
});

describe("closeLoop", () => {
  it("moves the end onto the target and leaves the start", () => {
    const { points } = closeLoop([{ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 1, y: 0 }]);
    expect(points[0]).toEqual({ x: 0, y: 0 });
    expect(points[2].x).toBeCloseTo(0);
  });
});

describe("helpers", () => {
  it("knows inside from outside", () => {
    const room = [{ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 5, y: 5 }, { x: 5, y: 0 }];
    expect(pointInPolygon({ x: 2, y: 2 }, room)).toBe(true);
    expect(pointInPolygon({ x: 6, y: 2 }, room)).toBe(false);
  });

  it("knows left from right", () => {
    expect(sideOf({ x: 1, y: 5 }, { x: 0, y: 0 }, { x: 0, y: 10 })).toBe("right");
    expect(sideOf({ x: -1, y: 5 }, { x: 0, y: 0 }, { x: 0, y: 10 })).toBe("left");
  });
});

describe("clampInside", () => {
  const room = [{ x: 0, y: 0 }, { x: 0, y: 5 }, { x: 4, y: 5 }, { x: 4, y: 0 }];

  it("leaves a point well inside the room alone", () => {
    expect(clampInside({ x: 2, y: 2 }, room)).toEqual({ x: 2, y: 2 });
  });

  it("pulls a point beyond a wall back inside", () => {
    const p = clampInside({ x: 6, y: 2 }, room, 0.3);
    expect(p.x).toBeCloseTo(3.7);
    expect(p.y).toBeCloseTo(2);
  });

  it("keeps a margin from the wall", () => {
    const p = clampInside({ x: 2, y: 4.95 }, room, 0.3);
    expect(p.y).toBeCloseTo(4.7);
  });
});

describe("outlineFromCorners", () => {
  const drifting = (list: number[], total: number) => list.map((h, i) => (h + (total * i) / list.length + 360) % 360);

  it("builds the room from the corners the recorder marked", () => {
    // entrance in the middle of the bottom wall: 3 steps left, corner, 8 up, corner, 6 right, corner, 8 down, corner, 3 left
    const walk = [...steps(270, 3), ...steps(0, 8), ...steps(90, 6), ...steps(180, 8), ...steps(270, 3)];
    const { outline } = outlineFromCorners(noisy(walk), [3, 11, 17, 25], 1);
    expect(outline).toEqual([{ x: 0, y: 0 }, { x: -3, y: 0 }, { x: -3, y: 8 }, { x: 3, y: 8 }, { x: 3, y: 0 }]);
  });

  it("is not fooled by a messy turn at a corner", () => {
    // at each corner the recorder shuffles round: two steps half way through the turn
    const walk = [...steps(0, 8), 40, 50, ...steps(90, 6), 130, 140, ...steps(180, 8), 220, 230, ...steps(270, 6)];
    const { outline } = outlineFromCorners(drifting(noisy(walk), 30), [9, 17, 27], 1);
    expect(outline).toHaveLength(4);
    for (const corner of outline) {
      expect(Math.abs(corner.x - Math.round(corner.x))).toBeLessThan(0.6);
    }
  });

  it("ignores a corner pressed twice", () => {
    const walk = [...steps(0, 5), ...steps(90, 5), ...steps(180, 5), ...steps(270, 5)];
    expect(outlineFromCorners(walk, [5, 5, 10, 15], 1).outline).toHaveLength(4);
  });

  it("treats a corner pressed in the middle of a straight wall as part of the wall", () => {
    const walk = [...steps(0, 10), ...steps(90, 5), ...steps(180, 10), ...steps(270, 5)];
    expect(outlineFromCorners(walk, [5, 10, 15, 25], 1).outline).toHaveLength(4);
  });

  it("draws a plus shaped room walked with a drifting phone and messy corners", () => {
    // the room from a real test: entrance at the bottom, 12 corners, walked clockwise
    const room: [number, number][] = [[0, 3], [270, 3], [0, 3], [90, 3], [0, 3], [90, 3], [180, 3], [90, 3], [180, 3], [270, 3], [180, 3], [270, 3]];
    const walk: number[] = [];
    const corners: number[] = [];
    room.forEach(([heading, count], i) => {
      walk.push(...steps(heading, count));
      // in the corner: an extra press, a shuffle half way through the turn and a step back
      if (i === 3) corners.push(walk.length);
      const next = room[(i + 1) % room.length][0];
      walk.push(heading + turnHalf(heading, next));
      corners.push(walk.length);
    });
    corners.splice(5, 0, corners[5] - 2); // a press in the middle of a wall
    // one short wall measured right between two axes
    walk.splice(corners[7], 2, walk[corners[7]] + 44, walk[corners[7]] + 44);
    const drifted = noisy(walk).map((h, i) => (h + 35 * (i / walk.length) + (i > 20 ? 20 : 0) + 360) % 360);
    const { outline } = outlineFromCorners(drifted, corners, 1);
    expect(outline).toHaveLength(12);
    for (let i = 0; i < outline.length; i++) {
      const a = outline[i];
      const b = outline[(i + 1) % outline.length];
      expect(Math.min(Math.abs(a.x - b.x), Math.abs(a.y - b.y))).toBeLessThan(0.01);
    }
  });
});

function turnHalf(from: number, to: number) {
  const turn = ((to - from + 540) % 360) - 180;
  return turn / 2;
}

describe("setWallLength", () => {
  const room = [{ x: 0, y: 0 }, { x: 0, y: 7 }, { x: 5, y: 7 }, { x: 5, y: 0 }];

  it("makes a wall longer and keeps the room closed and square", () => {
    expect(setWallLength(room, 1, 6)).toEqual([{ x: 0, y: 0 }, { x: 0, y: 7 }, { x: 6, y: 7 }, { x: 6, y: 0 }]);
  });

  it("never moves the entrance", () => {
    for (let i = 0; i < room.length; i++) {
      const changed = setWallLength(room, i, 4);
      expect(changed[0]).toEqual({ x: 0, y: 0 });
      expect(distance(changed[i], changed[(i + 1) % 4])).toBeCloseTo(4);
    }
  });
});

describe("pointAlongOutline", () => {
  const room = [{ x: 0, y: 0 }, { x: 0, y: 6 }, { x: 4, y: 6 }, { x: 4, y: 0 }];

  it("finds the point a share of the way round the walls, and the wall's direction", () => {
    expect(pointAlongOutline(room, 0.25)).toEqual({ point: { x: 0, y: 5 }, heading: 0 });
    expect(pointAlongOutline(room, 0.5)).toEqual({ point: { x: 4, y: 6 }, heading: 90 });
    expect(pointAlongOutline(room, 0.9).heading).toBe(270);
  });
});
