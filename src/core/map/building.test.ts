import { describe, expect, it } from "vitest";
import { afterDoor, buildingLayout, doorLinks, onWall, place, roomRoute } from "./building";
import type { FloorMap, Spot } from "./types";

const spot = (id: string, x: number, y: number, heading: number, extra: Partial<Spot> = {}): Spot => ({
  id, kind: "place", name: id, x, y, radius: 0, heading, photo: "", thumb: "", videoTime: 0, ...extra,
});

const room = (id: string, spots: Spot[], outline = [{ x: -3, y: 0 }, { x: -3, y: 6 }, { x: 3, y: 6 }, { x: 3, y: 0 }]): FloorMap => ({
  id, name: id, status: "published", createdBy: "", createdAt: "", updatedAt: "", videoUrl: null, outline, spots, walked: [], closureError: 0, version: 1,
});

// office: entrance at the bottom, a door in the right wall (facing east, 90) to the kitchen
// kitchen: its entrance is that door, recorded facing back into the office
const office = room("office", [spot("s1", 0, 0, 0), spot("s2", 2.8, 3, 90, { door: true, leadsTo: { mapId: "kitchen", spotId: "s1" } }), spot("s3", -2, 5, 0)]);
const kitchen = room("kitchen", [spot("s1", 0, 0.3, 180), spot("s2", 1, 5, 0)]);
const store = room("store", [spot("s1", 0, 0, 0)]);

describe("doorLinks", () => {
  it("joins two rooms when one side of the door is set", () => {
    const links = doorLinks([office, kitchen, store]);
    expect(links).toHaveLength(1);
    expect(links[0].b.map.id).toBe("kitchen");
  });

  it("counts a door set on both sides once", () => {
    const both = room("kitchen", [spot("s1", 0, 0.3, 180, { door: true, leadsTo: { mapId: "office", spotId: "s2" } }), spot("s2", 1, 5, 0)]);
    expect(doorLinks([office, both])).toHaveLength(1);
  });

  it("ignores a door to a room that is not published", () => {
    expect(doorLinks([office, store])).toHaveLength(0);
  });
});

describe("roomRoute", () => {
  it("needs no door inside one room", () => {
    expect(roomRoute([office, kitchen], { mapId: "office", point: { x: 0, y: 0 } }, { mapId: "office", spotId: "s3" })).toEqual([]);
  });

  it("goes through the door to a place in the next room", () => {
    const hops = roomRoute([office, kitchen], { mapId: "office", point: { x: 0, y: 0 } }, { mapId: "kitchen", spotId: "s2" });
    expect(hops).toEqual([{ from: { mapId: "office", spotId: "s2" }, to: { mapId: "kitchen", spotId: "s1" } }]);
  });

  it("works backwards too", () => {
    const hops = roomRoute([office, kitchen], { mapId: "kitchen", point: { x: 1, y: 5 } }, { mapId: "office", spotId: "s3" });
    expect(hops).toEqual([{ from: { mapId: "kitchen", spotId: "s1" }, to: { mapId: "office", spotId: "s2" } }]);
  });

  it("finds no way to a room without a door", () => {
    expect(roomRoute([office, kitchen, store], { mapId: "office", point: { x: 0, y: 0 } }, { mapId: "store", spotId: "s1" })).toBeNull();
  });

  it("crosses a room in the middle", () => {
    const hall = room("hall", [spot("s1", 0, 0, 0), spot("s2", 0, 5.8, 0, { door: true, leadsTo: { mapId: "office", spotId: "s1" } })]);
    const office2 = room("office", [spot("s1", 0, 0, 180), spot("s2", 2.8, 3, 90, { door: true, leadsTo: { mapId: "kitchen", spotId: "s1" } })]);
    const hops = roomRoute([hall, office2, kitchen], { mapId: "hall", point: { x: 0, y: 1 } }, { mapId: "kitchen", spotId: "s2" });
    expect(hops?.map((h) => `${h.from.mapId}>${h.to.mapId}`)).toEqual(["hall>office", "office>kitchen"]);
  });
});

describe("afterDoor", () => {
  it("treats the entrance as a door straight behind the start", () => {
    const { point, facing } = afterDoor(office, office.spots[0]);
    expect(facing).toBe(0);
    expect(point.y).toBeCloseTo(0.7);
  });

  it("puts the person a step into the room, facing away from the door", () => {
    const { point, facing } = afterDoor(kitchen, kitchen.spots[0]);
    expect(facing).toBe(0);
    expect(point.y).toBeCloseTo(1);
  });
});

describe("buildingLayout", () => {
  it("joins the two sides of the door and turns the next room to face the right way", () => {
    const layout = buildingLayout([office, kitchen]);
    const a = place(onWall(office.spots[1], office.outline), layout.get("office")!);
    const b = place(onWall(kitchen.spots[0], kitchen.outline), layout.get("kitchen")!);
    expect(b.x).toBeCloseTo(a.x);
    expect(b.y).toBeCloseTo(a.y);
    // going into the kitchen is going east from the office, so the kitchen lies to the east
    const far = place(kitchen.spots[1], layout.get("kitchen")!);
    expect(far.x).toBeGreaterThan(a.x + 3);
  });

  it("lays a room without doors next to the others", () => {
    const layout = buildingLayout([office, kitchen, store]);
    expect(layout.get("store")!.dx).toBeGreaterThan(3);
  });

  it("lays the two door walls exactly against each other even when the door was recorded at a slant", () => {
    // the phone said 70 degrees instead of 90, the wall itself is straight north-south
    const slanted = room("office", [office.spots[0], { ...office.spots[1], heading: 70 }, office.spots[2]]);
    const layout = buildingLayout([slanted, kitchen]);
    const t = layout.get("kitchen")!;
    // the kitchen's entrance wall (y = 0) must end up vertical, on the line x = 3 of the office's right wall
    const a = place({ x: -3, y: 0 }, t);
    const b = place({ x: 3, y: 0 }, t);
    expect(a.x).toBeCloseTo(3);
    expect(b.x).toBeCloseTo(3);
  });
});
