import { bounds, type Point, type Spot } from "@/core/map";

type RoomSketchProps = {
  outline: Point[];
  spots: Spot[];
  trace?: Point[];
  route?: Point[];
  position?: Point | null;
  highlightId?: string | null;
  blockedIds?: string[];
  label: string;
  onSpotPointerDown?: (spot: Spot, event: React.PointerEvent<SVGGElement>) => void;
  onCornerPointerDown?: (index: number, event: React.PointerEvent<SVGRectElement>) => void;
  svgRef?: React.Ref<SVGSVGElement>;
  frame?: Frame | null; // fixed while something is being dragged, otherwise the drawing rescales under the finger
  numberWalls?: boolean;
};

export type Frame = { minX: number; maxX: number; minY: number; maxY: number };

export const sketchScale = 40; // svg units per metre

// where on the floor a finger touched the drawing, in metres
export function pointOnSketch(svg: SVGSVGElement | null, event: { clientX: number; clientY: number }): Point | null {
  const matrix = svg?.getScreenCTM();
  if (!svg || !matrix) return null;
  const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
  const x = Number(svg.dataset.minX) + point.x / sketchScale;
  const y = Number(svg.dataset.maxY) - point.y / sketchScale;
  return { x: Math.round(x * 100) / 100 + 0, y: Math.round(y * 100) / 100 + 0 };
}
const pad = 1.5; // metres around the room

// the room seen from above: walls, places (circles), obstacles (hatched), walked line and route
export function RoomSketch({
  outline,
  spots,
  trace = [],
  route = [],
  position,
  highlightId,
  blockedIds = [],
  label,
  onSpotPointerDown,
  onCornerPointerDown,
  svgRef,
  frame,
  numberWalls,
}: RoomSketchProps) {
  const all = [...outline, ...spots, ...trace, ...route, ...(position ? [position] : []), { x: 0, y: 0 }];
  const box = frame ?? bounds(all);
  const width = (box.maxX - box.minX + pad * 2) * sketchScale;
  const height = (box.maxY - box.minY + pad * 2) * sketchScale;
  // north of the room frame (into the room) is drawn upwards
  const sx = (x: number) => (x - box.minX + pad) * sketchScale;
  const sy = (y: number) => (box.maxY - y + pad) * sketchScale;
  const line = (points: Point[]) => points.map((p) => `${sx(p.x)},${sy(p.y)}`).join(" ");

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${Math.max(width, 200)} ${Math.max(height, 200)}`}
      className="max-h-[28rem] w-full touch-none rounded-xl border-2 border-border bg-card"
      role="img"
      aria-label={label}
      data-scale={sketchScale}
      data-min-x={box.minX - pad}
      data-max-y={box.maxY + pad}
    >
      <defs>
        <pattern id="hatch" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="8" stroke="var(--danger)" strokeWidth="3" />
        </pattern>
      </defs>
      {outline.length > 2 && (
        <polygon points={line(outline)} fill="var(--bg)" stroke="var(--fg)" strokeWidth={6} strokeLinejoin="round" />
      )}
      {numberWalls &&
        outline.map((corner, i) => {
          const next = outline[(i + 1) % outline.length];
          return (
            <text
              key={`wall-${i}`}
              x={(sx(corner.x) + sx(next.x)) / 2}
              y={(sy(corner.y) + sy(next.y)) / 2 + 5}
              textAnchor="middle"
              stroke="var(--fg)"
              strokeWidth={4}
              paintOrder="stroke"
              pointerEvents="none"
              className="fill-bg text-[15px] font-bold"
            >
              {i + 1}
            </text>
          );
        })}
      {trace.length > 1 && (
        <polyline points={line(trace)} fill="none" stroke="var(--border)" strokeWidth={2} strokeDasharray="4 6" />
      )}
      {route.length > 1 && (
        <polyline points={line(route)} fill="none" stroke="var(--primary)" strokeWidth={6} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {spots.map((spot, i) => {
        const blocked = blockedIds.includes(spot.id);
        const x = sx(spot.x);
        const y = sy(spot.y);
        return (
          <g
            key={spot.id}
            onPointerDown={onSpotPointerDown ? (event) => onSpotPointerDown(spot, event) : undefined}
            className={onSpotPointerDown ? "cursor-grab" : undefined}
          >
            {spot.kind === "obstacle" ? (
              <circle cx={x} cy={y} r={Math.max(spot.radius * sketchScale, 8)} fill="url(#hatch)" stroke="var(--danger)" strokeWidth={3} />
            ) : (
              <circle
                cx={x}
                cy={y}
                r={spot.id === highlightId ? 13 : 9}
                fill={blocked ? "var(--danger)" : i === 0 ? "var(--ok)" : "var(--primary)"}
                stroke="var(--fg)"
                strokeWidth={3}
              />
            )}
            <text x={x + 14} y={y + 5} stroke="var(--card)" strokeWidth={5} paintOrder="stroke" pointerEvents="none" className="fill-fg text-[14px] font-semibold">
              {spot.name}
            </text>
          </g>
        );
      })}
      {/* corner handles are drawn last so labels never cover them */}
      {onCornerPointerDown &&
        outline.map((corner, i) =>
          i === 0 ? null : (
            <rect
              key={`corner-${i}`}
              x={sx(corner.x) - 11}
              y={sy(corner.y) - 11}
              width={22}
              height={22}
              rx={4}
              fill="var(--bg)"
              stroke="var(--fg)"
              strokeWidth={3}
              className="cursor-grab"
              onPointerDown={(event) => onCornerPointerDown(i, event)}
            />
          ),
        )}
      {position && <circle cx={sx(position.x)} cy={sy(position.y)} r={10} fill="var(--warn-fg)" stroke="var(--bg)" strokeWidth={3} />}
    </svg>
  );
}
