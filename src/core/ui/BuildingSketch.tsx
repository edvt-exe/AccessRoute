import { bounds, buildingLayout, doorLinks, onWall, place, type FloorMap, type Point } from "@/core/map";

const scale = 30; // svg units per metre
const pad = 1.5;

// all rooms seen from above, joined at their doors
export function BuildingSketch({ maps }: { maps: FloorMap[] }) {
  const layout = buildingLayout(maps);
  const joined = new Set(doorLinks(maps).flatMap(({ a, b }) => [`${a.map.id}/${a.spot.id}`, `${b.map.id}/${b.spot.id}`]));
  const rooms = maps.map((map) => {
    const t = layout.get(map.id)!;
    const outline = map.outline.map((p) => place(p, t));
    const middle = outline.reduce((sum, p) => ({ x: sum.x + p.x / outline.length, y: sum.y + p.y / outline.length }), { x: 0, y: 0 });
    // a joined door is drawn in the wall, where the two rooms meet
    const at = (s: FloorMap["spots"][number]) => place(joined.has(`${map.id}/${s.id}`) ? onWall(s, map.outline) : s, t);
    return { map, outline, middle, spots: map.spots.map((s) => ({ spot: s, at: at(s) })) };
  });
  const box = bounds(rooms.flatMap((r) => r.outline).concat({ x: 0, y: 0 }));
  const sx = (x: number) => (x - box.minX + pad) * scale;
  const sy = (y: number) => (box.maxY - y + pad) * scale;
  const line = (points: Point[]) => points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ");
  const width = (box.maxX - box.minX + pad * 2) * scale;
  const height = (box.maxY - box.minY + pad * 2) * scale;

  return (
    <svg
      viewBox={`0 0 ${Math.max(width, 200)} ${Math.max(height, 200)}`}
      className="max-h-[70dvh] w-full rounded-xl border-2 border-border bg-card"
      role="img"
      aria-label={`Building map with ${maps.length} rooms: ${maps.map((m) => m.name).join(", ")}`}
    >
      {rooms.map((r) => (
        <polygon key={r.map.id} points={line(r.outline)} fill="var(--bg)" stroke="var(--fg)" strokeWidth={5} strokeLinejoin="round" />
      ))}
      {rooms.flatMap((r) =>
        r.spots.map(({ spot, at }) =>
          spot.kind === "obstacle" ? (
            <circle key={`${r.map.id}-${spot.id}`} cx={sx(at.x)} cy={sy(at.y)} r={Math.max(spot.radius * scale, 6)} fill="none" stroke="var(--danger)" strokeWidth={2} />
          ) : joined.has(`${r.map.id}/${spot.id}`) ? (
            <rect key={`${r.map.id}-${spot.id}`} x={sx(at.x) - 8} y={sy(at.y) - 8} width={16} height={16} rx={3} fill="var(--ok)" stroke="var(--fg)" strokeWidth={2} />
          ) : (
            <circle key={`${r.map.id}-${spot.id}`} cx={sx(at.x)} cy={sy(at.y)} r={6} fill="var(--primary)" />
          ),
        ),
      )}
      {rooms.map((r) => (
        <text
          key={`name-${r.map.id}`}
          x={sx(r.middle.x)}
          y={sy(r.middle.y)}
          textAnchor="middle"
          stroke="var(--bg)"
          strokeWidth={5}
          paintOrder="stroke"
          className="fill-fg text-[18px] font-bold"
        >
          {r.map.name}
        </text>
      ))}
    </svg>
  );
}
