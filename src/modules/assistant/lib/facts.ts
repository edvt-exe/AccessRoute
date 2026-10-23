import { distance, distanceToOutline, type FloorMap, type Spot } from "@/core/map";

// a wheelchair needs about 90 cm, a person with a cane or a guide dog about the same
const narrow = 0.9;

const hazardText = { head: "sticks out at head height, a cane does not find it", stairs: "is a step or stairs", glass: "is glass" } as const;

// what can be measured in one room: the ai only writes these up, it does not add any
export function roomFacts(map: FloorMap, unreachable: Spot[], temporary: number) {
  const facts: string[] = [];
  const obstacles = map.spots.filter((s) => s.kind === "obstacle");
  const cm = (m: number) => Math.round(m * 10) * 10;
  for (const o of obstacles) {
    const gap = distanceToOutline(o, map.outline) - o.radius;
    if (gap > 0.15 && gap < narrow) facts.push(`The passage between ${o.name} and the wall is only about ${cm(gap)} cm wide.`);
  }
  for (const [i, a] of obstacles.entries()) {
    for (const b of obstacles.slice(i + 1)) {
      const gap = distance(a, b) - a.radius - b.radius;
      if (gap > 0.15 && gap < narrow) facts.push(`The passage between ${a.name} and ${b.name} is only about ${cm(gap)} cm wide.`);
    }
  }
  for (const s of map.spots) if (s.hazard) facts.push(`${s.name} ${hazardText[s.hazard]}.`);
  (map.walls ?? []).forEach((w, i) => {
    if (w?.glass) facts.push(`Wall ${i + 1} is glass.`);
  });
  const doors = map.spots.filter((s) => s.door);
  for (const d of doors) {
    if (!d.leadsTo) facts.push(`The door "${d.name}" is not joined to another room on the map, guidance cannot go through it.`);
    if (d.via === "lift") {
      facts.push(`"${d.name}" is a lift to another floor.`);
      continue;
    }
    if (d.via === "stairs") {
      const st = d.stairs;
      facts.push(
        st
          ? `"${d.name}" are stairs going ${st.going}, ${st.steps} steps, ${st.handrail === "none" ? "without a handrail" : st.handrail === "both" ? "with handrails on both sides" : `with a handrail on the ${st.handrail}`}.`
          : `"${d.name}" are stairs; the number of steps and the handrail are not recorded.`,
      );
      continue;
    }
    if (d.opens === "in") facts.push(`The door "${d.name}" swings into the room, towards people walking along the wall.`);
    if (d.opens == null) facts.push(`It is not recorded how the door "${d.name}" opens.`);
  }
  for (const s of unreachable) facts.push(`There is no route from the entrance to ${s.name} around the obstacles.`);
  const places = map.spots.filter((s) => s.kind === "place");
  const bare = places.filter((s) => !s.description);
  if (bare.length) facts.push(`${bare.length} of ${places.length} places have no description to read out on arrival.`);
  if (temporary) facts.push(`${temporary} temporary obstacle${temporary > 1 ? "s are" : " is"} in the room right now.`);
  if (map.closureError > 2) facts.push(`The recording did not close well (${map.closureError.toFixed(1)} m), the outline may be inaccurate.`);
  return facts;
}
