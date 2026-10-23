import { loadPublishedMaps } from "@/core/storage/maps";
import { writeReport } from "@/modules/assistant/api/report";
import { roomFacts } from "@/modules/assistant/lib/facts";
import { planPath } from "@/modules/guidance/lib/plan";
import { getObstacles } from "@/modules/reports/api/obstacles";

export const maxDuration = 60;

// the measurements come from the maps, the ai only turns them into a report
export async function POST() {
  const [maps, temporary] = await Promise.all([loadPublishedMaps(), getObstacles()]);
  const rooms = maps.map((map) => {
    const entrance = map.spots[0];
    const unreachable = entrance
      ? map.spots.filter((s, i) => {
          const plan = i > 0 && s.kind === "place" ? planPath(map, entrance, s.id) : null;
          return plan !== null && !plan.ok && plan.reason === "no-path";
        })
      : [];
    return { room: map.name, facts: roomFacts(map, unreachable, temporary.filter((o) => o.mapId === map.id).length) };
  });
  return Response.json(await writeReport(rooms));
}
