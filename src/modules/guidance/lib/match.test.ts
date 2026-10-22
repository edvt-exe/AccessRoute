import { describe, expect, it } from "vitest";
import type { Spot } from "@/core/map";
import { matchPlace } from "./match";

const names = ["Main entrance", "Reception", "Lift 1", "Kitchen", "Women's toilet", "Lift 2", "Room 4.1"];
const spots = names.map((name, i) => ({ id: `s${i}`, kind: "place", name, x: 0, y: 0, radius: 0, heading: 0, photo: "", thumb: "", videoTime: 0 }) as Spot);

describe("matchPlace", () => {
  it.each([
    ["lift 1", "Lift 1"],
    ["take me to lift one", "Lift 1"],
    ["Lift number 2", "Lift 2"],
    ["lift to", "Lift 2"],
    ["the kitchen please", "Kitchen"],
    ["womens toilet", "Women's toilet"],
    ["toilet", "Women's toilet"],
    ["the entrance", "Main entrance"],
    ["room four point one", "Room 4.1"],
  ])("understands %s", (spoken, expected) => {
    expect(matchPlace(spoken, spots)?.place.name).toBe(expected);
  });

  it.each(["lift", "lift 3", "parking", ""])("does not guess for %s", (spoken) => {
    expect(matchPlace(spoken, spots)).toBeNull();
  });
});
