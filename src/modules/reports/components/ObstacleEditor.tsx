"use client";

import { useRef, useState } from "react";
import { clampInside, obstacleRadius, round, type FloorMap, type Hazard, type ObstacleSize, type Point, type Spot, type TempObstacle } from "@/core/map";
import { Button, LiveRegion, Notice, RoomSketch, pointOnSketch } from "@/core/ui";
import { addObstacle, obstacleSpot, removeObstacle } from "../lib/client";

const kinds = ["Wet floor", "Boxes in the way", "Ladder", "Cleaning trolley", "Other"];
const sizes: { key: ObstacleSize; label: string }[] = [
  { key: "small", label: "Small" },
  { key: "medium", label: "Medium" },
  { key: "large", label: "Large" },
];
// 0 hours means it stays: it becomes part of the map
const durations = [
  { hours: 1, label: "1 hour" },
  { hours: 4, label: "4 hours" },
  { hours: 24, label: "Until tomorrow" },
  { hours: 24 * 7, label: "1 week" },
  { hours: 0, label: "Always (part of the map)" },
];

const hazards: { key: Hazard | ""; label: string }[] = [
  { key: "", label: "No, a cane finds it" },
  { key: "head", label: "Yes, it sticks out at head height" },
  { key: "stairs", label: "Yes, a step or stairs" },
  { key: "glass", label: "Yes, glass" },
];

const field = "min-h-12 rounded-lg border-2 border-fg bg-bg px-3 text-lg";

type ObstacleEditorProps = {
  map: FloorMap;
  obstacles: TempObstacle[];
  staffName: string;
  onAddPermanent: (spot: Spot) => Promise<void>;
};

// the next free id in the map: s1, s2, ... ids are never reused within a map
function nextSpotId(map: FloorMap) {
  const numbers = map.spots.map((s) => Number(/^s(\d+)$/.exec(s.id)?.[1] ?? 0));
  return `s${Math.max(0, ...numbers) + 1}`;
}

function timeLeft(until: string) {
  const minutes = Math.max(0, Math.round((Date.parse(until) - Date.now()) / 60000));
  if (minutes < 60) return `${minutes} min left`;
  if (minutes < 48 * 60) return `${Math.round(minutes / 60)} h left`;
  return `${Math.round(minutes / 60 / 24)} days left`;
}

// tap where it is on the drawing, say what it is and for how long
export function ObstacleEditor({ map, obstacles, staffName, onAddPermanent }: ObstacleEditorProps) {
  const svg = useRef<SVGSVGElement>(null);
  const [at, setAt] = useState<Point | null>(null);
  const [kind, setKind] = useState(kinds[0]);
  const [other, setOther] = useState("");
  const [size, setSize] = useState<ObstacleSize>("medium");
  const radius = obstacleRadius(size, map.outline);
  const [hours, setHours] = useState(4);
  const [hazard, setHazard] = useState<Hazard | "">("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const mine = obstacles.filter((o) => o.mapId === map.id);
  const name = kind === "Other" ? other.trim() : kind;
  const marker: Spot | null = at ? { id: "new", kind: "obstacle", name: `${name || "New obstacle"} (new)`, ...at, radius, heading: null, photo: "", thumb: "", videoTime: 0 } : null;

  async function save() {
    if (!at || name.length < 2) return;
    setBusy(true);
    try {
      if (hours === 0) {
        await onAddPermanent({ id: nextSpotId(map), kind: "obstacle", name, ...at, radius, heading: null, photo: "", thumb: "", videoTime: 0, ...(hazard ? { hazard } : {}) });
        setMessage(`${name} is now part of the map.`);
      } else {
        await addObstacle({ mapId: map.id, name, ...at, radius, hours, reportedBy: staffName, hazard: hazard || null });
        setMessage(`${name} added. Guided routes go around it and warn about it until it expires.`);
      }
      setAt(null);
      setOther("");
      setHazard("");
    } catch (e) {
      setMessage(`Could not add it: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(o: TempObstacle) {
    setBusy(true);
    try {
      await removeObstacle(o.id);
      setMessage(`${o.name} removed.`);
    } catch (e) {
      setMessage(`Could not remove it: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <LiveRegion message={message} />
      <div
        onPointerDown={(event) => {
          const point = pointOnSketch(svg.current, event);
          if (point && map.outline.length > 2) setAt(round(clampInside(point, map.outline, Math.max(0.15, radius * 0.5))));
        }}
      >
        <RoomSketch
          svgRef={svg}
          outline={map.outline}
          spots={[...map.spots, ...mine.map(obstacleSpot), ...(marker ? [marker] : [])]}
          highlightId="new"
          label={`Room ${map.name}. Tap where the obstacle is.`}
        />
        <p className="mt-1 text-muted">{at ? "Tap again to move it." : "Tap the drawing where the obstacle is."}</p>
      </div>

      <fieldset className="flex flex-col gap-3 rounded-xl border-2 border-border p-4">
        <legend className="px-1 text-lg font-bold">New obstacle</legend>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">What is it?</span>
          <select value={kind} onChange={(e) => setKind(e.target.value)} className={field}>
            {kinds.map((k) => (
              <option key={k}>{k}</option>
            ))}
          </select>
        </label>
        {kind === "Other" && (
          <label className="flex flex-col gap-1">
            <span className="font-semibold">Name</span>
            <input value={other} maxLength={60} onChange={(e) => setOther(e.target.value)} className={field} />
          </label>
        )}
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Size</span>
          <select value={size} onChange={(e) => setSize(e.target.value as ObstacleSize)} className={field}>
            {sizes.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}, about {(obstacleRadius(s.key, map.outline) * 2).toFixed(1)} m across
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">Anything a cane will not warn about?</span>
          <select value={hazard} onChange={(e) => setHazard(e.target.value as Hazard | "")} className={field}>
            {hazards.map((h) => (
              <option key={h.key} value={h.key}>
                {h.label}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1">
          <span className="font-semibold">How long?</span>
          <select value={hours} onChange={(e) => setHours(Number(e.target.value))} className={field}>
            {durations.map((d) => (
              <option key={d.hours} value={d.hours}>
                {d.label}
              </option>
            ))}
          </select>
        </label>
        <Button onClick={() => void save()} disabled={busy || !at || name.length < 2}>
          Add obstacle
        </Button>
      </fieldset>

      {message && <Notice>{message}</Notice>}

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl font-bold">Temporary obstacles ({mine.length})</h2>
        {mine.length === 0 && <p className="text-lg">None right now.</p>}
        {mine.map((o) => (
          <div key={o.id} className="flex items-center justify-between gap-3 rounded-xl border-2 border-border p-3">
            <span className="text-lg">
              <strong>{o.name}</strong> · {timeLeft(o.until)}
              {o.reportedBy && ` · ${o.reportedBy}`}
            </span>
            <Button variant="secondary" onClick={() => void remove(o)} disabled={busy}>
              Remove
            </Button>
          </div>
        ))}
      </section>
    </div>
  );
}
