"use client";

/* eslint-disable @next/next/no-img-element -- photos are inline jpegs from the recording */
import { useEffect, useRef, useState } from "react";
import { analyseRoom, type HazardSuggestion } from "@/core/ai/client";
import {
  bounds,
  distance,
  obstacleRadius,
  obstacleSizeOf,
  round,
  setWallLength,
  type DoorOpening,
  type FloorMap,
  type Hazard,
  type MapSummary,
  type ObstacleSize,
  type Passage,
  type Spot,
  type Stairs,
  type WallSide,
} from "@/core/map";
import { Button, LinkButton, LiveRegion, Notice, RoomSketch, pointOnSketch, type Frame } from "@/core/ui";
import { deleteMap, saveMap } from "../lib/client";

type ReviewEditorProps = {
  initial: FloorMap;
  otherRooms?: MapSummary[]; // where a door can lead
  blockedIds: string[];
  onDeleted: () => void;
};

const field = "min-h-12 rounded-lg border-2 border-fg bg-bg px-3 text-lg";
const sizes: { key: ObstacleSize; label: string }[] = [
  { key: "small", label: "Small" },
  { key: "medium", label: "Medium" },
  { key: "large", label: "Large" },
];
const hazards: { key: Hazard | ""; label: string }[] = [
  { key: "", label: "No, a cane finds it" },
  { key: "head", label: "Yes, it sticks out at head height" },
  { key: "stairs", label: "Yes, a step or stairs" },
  { key: "glass", label: "Yes, glass" },
];
const openings: { key: DoorOpening | ""; label: string }[] = [
  { key: "", label: "I do not know" },
  { key: "in", label: "It swings into this room" },
  { key: "out", label: "It swings away, out of this room" },
  { key: "sliding", label: "It slides" },
];
const nudge = 0.25; // metres per arrow press

// the next free id in the map: s1, s2, ... ids are never reused within a map
function nextSpotId(map: FloorMap) {
  const numbers = map.spots.map((s) => Number(/^s(\d+)$/.exec(s.id)?.[1] ?? 0));
  return `s${Math.max(0, ...numbers) + 1}`;
}

// "door to the kitchen" most likely leads into the room called kitchen, to its entrance or a door there
function suggestDoor(name: string, rooms: MapSummary[]) {
  const words = name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2 && w !== "door");
  const room = rooms.find((r) => r.name.toLowerCase().split(/[^a-z0-9]+/).some((w) => words.includes(w)));
  const place = room && (room.places.find((p) => p.door) ?? room.places[0]);
  return room && place ? { mapId: room.id, spotId: place.id, label: `${room.name} – ${place.name}` } : null;
}

function timeLabel(seconds: number) {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

export function ReviewEditor({ initial, otherRooms = [], blockedIds, onDeleted }: ReviewEditorProps) {
  const [map, setMap] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const video = useRef<HTMLVideoElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef<{ kind: "spot"; id: string } | { kind: "corner"; index: number } | null>(null);
  const [checking, setChecking] = useState<"idle" | "busy" | "done" | "off">("idle");
  const [suggested, setSuggested] = useState<Record<string, string>>({});
  const [found, setFound] = useState<HazardSuggestion[]>([]);
  const checked = useRef(false);

  // the ai looks at the recording once: a description for every place and the hazards it sees.
  // nothing is used until the colleague accepts it
  async function check() {
    setChecking("busy");
    try {
      const result = await analyseRoom(map.id);
      if (!result.ok) {
        setChecking(result.reason === "ai-off" ? "off" : "idle");
        if (result.reason !== "ai-off") setMessage("The AI check did not work, try again.");
        return;
      }
      setSuggested(result.descriptions);
      setFound(result.hazards);
      setChecking("done");
    } catch (e) {
      setChecking("idle");
      setMessage(`The AI check did not work: ${(e as Error).message}`);
    }
  }

  // a new recording is checked by itself the first time it is opened
  useEffect(() => {
    if (checked.current || initial.status === "published" || initial.spots.some((s) => s.description)) return;
    checked.current = true;
    const timer = window.setTimeout(() => void check(), 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only once, for the map that was opened
  }, []);

  function acceptHazard(h: HazardSuggestion) {
    setMap((m) => ({
      ...m,
      spots: [
        ...m.spots,
        { id: nextSpotId(m), kind: "obstacle", name: h.name, x: h.x, y: h.y, radius: obstacleRadius("small", m.outline), heading: null, photo: "", thumb: "", videoTime: 0, ...(h.hazard ? { hazard: h.hazard } : {}) },
      ],
    }));
    setFound((list) => list.filter((x) => x !== h));
    setDirty(true);
  }

  function changeWallSide(index: number, patch: Partial<WallSide>) {
    setMap((m) => {
      const walls: WallSide[] = Array.from({ length: m.outline.length }, (_, i) => m.walls?.[i] ?? {});
      walls[index] = { ...walls[index], ...patch };
      return { ...m, walls };
    });
    setDirty(true);
  }

  function updateSpot(id: string, patch: Partial<Spot>) {
    setMap((m) => ({ ...m, spots: m.spots.map((s) => (s.id === id ? { ...s, ...patch } : s)) }));
    setDirty(true);
  }

  function changeWall(index: number, length: number) {
    if (!Number.isFinite(length) || length < 0.3 || length > 200) return;
    setMap((m) => ({ ...m, outline: setWallLength(m.outline, index, Math.round(length * 100) / 100) }));
    setDirty(true);
  }

  function removeSpot(id: string) {
    setMap((m) => ({ ...m, spots: m.spots.filter((s) => s.id !== id) }));
    setDirty(true);
  }

  // dragging a spot on the drawing fixes where the sensors placed it
  function toMetres(event: { clientX: number; clientY: number }) {
    return pointOnSketch(svg.current, event);
  }

  // the same box RoomSketch would compute now, kept while dragging
  function currentFrame(): Frame {
    return bounds([...map.outline, ...map.spots, ...map.walked, { x: 0, y: 0 }]);
  }

  function watch(spot: Spot) {
    setHighlight(spot.id);
    const v = video.current;
    if (!v) return;
    v.currentTime = Math.max(0, spot.videoTime - 3);
    void v.play().catch(() => {});
  }

  async function save(publish: boolean) {
    if (map.spots.some((s) => !s.name.trim())) {
      setMessage("Every place and obstacle needs a name.");
      return;
    }
    setBusy(true);
    try {
      const saved = await saveMap({ ...map, status: publish ? "published" : map.status });
      setMap(saved);
      setDirty(false);
      setMessage(publish ? "Published. Guided colleagues can now be led in this room." : "Changes saved.");
    } catch (e) {
      setMessage(`Could not save: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    setBusy(true);
    try {
      await deleteMap(map.id);
      onDeleted();
    } catch (e) {
      setMessage(`Could not delete: ${(e as Error).message}`);
      setBusy(false);
    }
  }

  const places = map.spots.filter((s) => s.kind === "place");
  const obstacles = map.spots.filter((s) => s.kind === "obstacle");

  return (
    <div className="flex flex-col gap-8">
      <LiveRegion message={message} />
      <div className="flex flex-col gap-2">
        <label htmlFor="map-name" className="text-lg font-semibold">
          Room name
        </label>
        <input
          id="map-name"
          value={map.name}
          maxLength={80}
          onChange={(e) => {
            setMap({ ...map, name: e.target.value });
            setDirty(true);
          }}
          className={field}
        />
        <label htmlFor="map-floor" className="text-lg font-semibold">
          Floor
        </label>
        <input
          id="map-floor"
          value={map.floor ?? ""}
          maxLength={30}
          placeholder="e.g. 2, -1 or ground floor. Said in the lift."
          onChange={(e) => {
            setMap({ ...map, floor: e.target.value || null });
            setDirty(true);
          }}
          className={field}
        />
        <p className="text-muted">
          Recorded by {map.createdBy || "a colleague"} · {map.status === "published" ? "published" : "waiting for review"}
        </p>
      </div>

      {map.closureError > 2 ? (
        <Notice tone="warn">
          The wall walk ended {map.closureError.toFixed(1)} m away from the entrance. The outline was corrected, but if it
          looks wrong, record the room again more slowly.
        </Notice>
      ) : (
        <Notice>
          The wall walk ended {map.closureError.toFixed(1)} m from the entrance and was corrected. Check the drawing against
          the video and drag any spot that is in the wrong place.
        </Notice>
      )}

      {map.videoUrl ? (
        <video ref={video} src={map.videoUrl} controls playsInline preload="metadata" className="w-full rounded-xl bg-black">
          <track kind="captions" />
        </video>
      ) : (
        <Notice tone="warn">No video was uploaded for this recording.</Notice>
      )}

      <div
        onPointerMove={(event) => {
          const drag = dragging.current;
          if (!drag) return;
          const point = toMetres(event);
          if (!point) return;
          if (drag.kind === "spot") updateSpot(drag.id, point);
          else {
            setMap((m) => ({ ...m, outline: m.outline.map((c, i) => (i === drag.index ? point : c)) }));
            setDirty(true);
          }
        }}
        onPointerUp={() => {
          dragging.current = null;
          setFrame(null);
        }}
        onPointerLeave={() => {
          dragging.current = null;
          setFrame(null);
        }}
      >
        <RoomSketch
          svgRef={svg}
          outline={map.outline}
          spots={map.spots}
          trace={map.walked}
          highlightId={highlight}
          blockedIds={blockedIds}
          label={`Room ${map.name} with ${places.length} places and ${obstacles.length} obstacles`}
          frame={frame}
          numberWalls
          onSpotPointerDown={(spot, event) => {
            if (spot.id === map.spots[0].id) return; // the entrance is the fixed reference point
            event.preventDefault();
            dragging.current = { kind: "spot", id: spot.id };
            setFrame(currentFrame());
            setHighlight(spot.id);
          }}
          onCornerPointerDown={(index, event) => {
            event.preventDefault();
            dragging.current = { kind: "corner", index };
            setFrame(currentFrame());
          }}
        />
        <p className="mt-2 text-muted">
          Walls in black, places as blue dots (green: entrance), obstacles hatched in red, the dashed line is the walk.
          The numbers are the walls listed below. Drag a wall corner (white square) or a spot to fix it. Spots can also be moved with the arrows below.
        </p>
      </div>

      <section className="flex flex-col gap-3" aria-live="polite">
        <h2 className="text-2xl font-bold">AI check</h2>
        {checking === "off" && <p className="text-lg">The AI is not configured, fill in the descriptions and hazards by hand.</p>}
        {checking === "busy" && <p className="text-lg">The AI is looking at the recording: describing the places and looking for hazards…</p>}
        {checking === "idle" && (
          <Button variant="secondary" onClick={() => void check()}>
            Let the AI describe the places and look for hazards
          </Button>
        )}
        {checking === "done" && (
          <>
            <p className="text-lg">
              The AI wrote {Object.keys(suggested).length} descriptions (below, at each place) and found {found.length} possible hazards. Check
              each one: only what you accept is used.
            </p>
            {found.map((h, i) => (
              <div key={`${h.name}-${i}`} className="flex flex-col gap-2 rounded-xl border-2 border-warn-fg p-3">
                <p className="text-lg">
                  <strong>{h.name}</strong>
                  {h.hazard ? ` (${h.hazard === "head" ? "head height" : h.hazard})` : ""}: {h.reason}
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <Button onClick={() => acceptHazard(h)}>Add as obstacle</Button>
                  <Button variant="secondary" onClick={() => setFound((list) => list.filter((x) => x !== h))}>
                    Not a hazard
                  </Button>
                </div>
                <span className="text-muted">Once added, drag it on the drawing to where it really is.</span>
              </div>
            ))}
          </>
        )}
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-bold">Walls ({map.outline.length})</h2>
        <p className="text-lg">
          Steps are only an estimate. Measure or pace the walls and type the real lengths, the corners stay square and the
          room stays closed. Wall 1 starts at the entrance and they follow the walk. Furniture standing against a wall (a
          sofa, cupboards) is felt instead of the wall: write it next to the wall, guidance then says &quot;keep the sofa on your left&quot;.
        </p>
        <ol className="flex flex-col gap-3">
          {map.outline.map((corner, i) => {
            const length = distance(corner, map.outline[(i + 1) % map.outline.length]);
            return (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <label htmlFor={`wall-${i}`} className="w-20 text-lg font-semibold">
                  Wall {i + 1}
                </label>
                <button
                  type="button"
                  aria-label={`Wall ${i + 1} 25 centimetres shorter`}
                  onClick={() => changeWall(i, length - nudge)}
                  className="min-h-12 min-w-12 rounded-lg border-2 border-fg text-xl font-bold"
                >
                  −
                </button>
                <input
                  id={`wall-${i}`}
                  key={length.toFixed(2)}
                  type="number"
                  inputMode="decimal"
                  step="0.1"
                  min="0.3"
                  defaultValue={length.toFixed(2)}
                  onBlur={(e) => changeWall(i, Number(e.target.value))}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") changeWall(i, Number(e.currentTarget.value));
                  }}
                  className={`${field} w-28`}
                />
                <span className="text-lg">m</span>
                <button
                  type="button"
                  aria-label={`Wall ${i + 1} 25 centimetres longer`}
                  onClick={() => changeWall(i, length + nudge)}
                  className="min-h-12 min-w-12 rounded-lg border-2 border-fg text-xl font-bold"
                >
                  +
                </button>
                <input
                  aria-label={`What stands along wall ${i + 1}`}
                  placeholder="Along it: e.g. sofa, cupboards"
                  value={map.walls?.[i]?.along ?? ""}
                  maxLength={60}
                  onChange={(e) => changeWallSide(i, { along: e.target.value || undefined })}
                  className={`${field} min-w-0 flex-1`}
                />
                <label className="flex min-h-12 items-center gap-2 text-lg">
                  <input type="checkbox" checked={Boolean(map.walls?.[i]?.glass)} onChange={(e) => changeWallSide(i, { glass: e.target.checked })} className="h-6 w-6" />
                  Glass
                </label>
              </li>
            );
          })}
        </ol>
      </section>

      {[
        { title: `Places (${places.length})`, list: places },
        { title: `Obstacles (${obstacles.length})`, list: obstacles },
      ].map(({ title, list }) => (
        <section key={title} className="flex flex-col gap-4">
          <h2 className="text-2xl font-bold">{title}</h2>
          {list.length === 0 && <p className="text-lg">None recorded.</p>}
          {list.map((spot) => {
            const entrance = spot.id === map.spots[0].id;
            return (
              <fieldset key={spot.id} className="flex flex-col gap-3 rounded-xl border-2 border-border p-4">
                <legend className="px-1 text-lg font-bold">
                  {spot.name || "Unnamed"} {entrance && "(entrance, starting point)"}
                </legend>
                {spot.photo && <img src={spot.photo} alt={`What the camera saw at ${spot.name}`} className="max-h-40 rounded-lg object-cover" />}
                <label className="flex flex-col gap-1">
                  <span className="font-semibold">Name</span>
                  <input value={spot.name} maxLength={60} onChange={(e) => updateSpot(spot.id, { name: e.target.value })} className={field} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="font-semibold">Description, read out on arrival</span>
                  <textarea
                    value={spot.description ?? ""}
                    maxLength={300}
                    rows={2}
                    placeholder="e.g. Wooden door, handle on the right, the coffee machine is next to it."
                    onChange={(e) => updateSpot(spot.id, { description: e.target.value || undefined })}
                    className={`${field} py-2`}
                  />
                </label>
                {suggested[spot.id] && suggested[spot.id] !== spot.description && (
                  <div className="flex flex-col gap-2 rounded-lg border-2 border-primary p-3">
                    <span className="text-lg">AI: {suggested[spot.id]}</span>
                    <Button variant="secondary" onClick={() => updateSpot(spot.id, { description: suggested[spot.id] })}>
                      Use this description
                    </Button>
                  </div>
                )}
                {spot.kind === "place" && (
                  <DoorFields spot={spot} rooms={otherRooms} onChange={(patch) => updateSpot(spot.id, patch)} />
                )}
                {spot.kind === "obstacle" && (
                  <label className="flex flex-col gap-1">
                    <span className="font-semibold">Anything a cane will not warn about?</span>
                    <select
                      value={spot.hazard ?? ""}
                      onChange={(e) => updateSpot(spot.id, { hazard: (e.target.value as Hazard) || null })}
                      className={field}
                    >
                      {hazards.map((h) => (
                        <option key={h.key} value={h.key}>
                          {h.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {spot.kind === "obstacle" && (
                  <label className="flex flex-col gap-1">
                    <span className="font-semibold">Size</span>
                    <select
                      value={obstacleSizeOf(spot.radius, map.outline)}
                      onChange={(e) => updateSpot(spot.id, { radius: obstacleRadius(e.target.value as ObstacleSize, map.outline) })}
                      className={field}
                    >
                      {sizes.map((s) => (
                        <option key={s.key} value={s.key}>
                          {s.label}, about {(obstacleRadius(s.key, map.outline) * 2).toFixed(1)} m across
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {!entrance && (
                  <div role="group" aria-label={`Move ${spot.name}`} className="grid grid-cols-4 gap-2">
                    {[
                      { label: "Left", dx: -nudge, dy: 0, icon: "←" },
                      { label: "Further in", dx: 0, dy: nudge, icon: "↑" },
                      { label: "Closer to the entrance", dx: 0, dy: -nudge, icon: "↓" },
                      { label: "Right", dx: nudge, dy: 0, icon: "→" },
                    ].map((move) => (
                      <button
                        key={move.label}
                        type="button"
                        aria-label={`Move ${move.label.toLowerCase()} by 25 centimetres`}
                        onClick={() => updateSpot(spot.id, round({ x: spot.x + move.dx, y: spot.y + move.dy }))}
                        className="min-h-12 rounded-lg border-2 border-fg text-xl font-bold"
                      >
                        {move.icon}
                      </button>
                    ))}
                  </div>
                )}
                <div className="flex flex-wrap gap-2">
                  {map.videoUrl && (
                    <Button variant="secondary" onClick={() => watch(spot)}>
                      Watch in video ({timeLabel(spot.videoTime)})
                    </Button>
                  )}
                  {!entrance && (
                    <Button variant="secondary" onClick={() => removeSpot(spot.id)}>
                      Remove
                    </Button>
                  )}
                </div>
              </fieldset>
            );
          })}
        </section>
      ))}

      {message && <Notice>{message}</Notice>}

      <div className="sticky bottom-0 flex flex-col gap-3 border-t-2 border-border bg-bg py-4">
        {dirty && (
          <Button variant="secondary" onClick={() => void save(false)} disabled={busy}>
            Save changes
          </Button>
        )}
        <LinkButton href={`/guide?map=${map.id}`} variant="secondary">
          Test as a guided user
        </LinkButton>
        {map.status !== "published" && (
          <Button onClick={() => void save(true)} disabled={busy} className="min-h-16 text-xl">
            Approve and publish
          </Button>
        )}
        <Button variant="danger" onClick={() => void remove()} disabled={busy}>
          {confirmDelete ? "Tap again to delete for good" : "Delete this map"}
        </Button>
      </div>
    </div>
  );
}

function DoorFields({ spot, rooms, onChange }: { spot: Spot; rooms: MapSummary[]; onChange: (patch: Partial<Spot>) => void }) {
  const value = spot.leadsTo ? `${spot.leadsTo.mapId}/${spot.leadsTo.spotId}` : "";
  const suggestion = spot.door && !spot.leadsTo ? suggestDoor(spot.name, rooms) : null;
  return (
    <div className="flex flex-col gap-2">
      <label className="flex min-h-12 items-center gap-3 text-lg">
        <input
          type="checkbox"
          checked={Boolean(spot.door)}
          onChange={(e) => onChange(e.target.checked ? { door: true } : { door: false, leadsTo: null, via: null, stairs: null })}
          className="h-6 w-6"
        />
        This leads to another room or floor
      </label>
      {spot.door && (
        <label className="flex flex-col gap-1">
          <span className="font-semibold">What is it?</span>
          <select
            value={spot.via ?? "door"}
            onChange={(e) => {
              const via = e.target.value as Passage;
              onChange({ via, stairs: via === "stairs" ? (spot.stairs ?? { steps: 12, going: "up", handrail: "right" }) : null, ...(via === "door" ? {} : { opens: null }) });
            }}
            className={field}
          >
            <option value="door">A door</option>
            <option value="lift">A lift</option>
            <option value="stairs">Stairs</option>
          </select>
        </label>
      )}
      {spot.door && spot.via === "stairs" && spot.stairs && (
        <StairsFields stairs={spot.stairs} onChange={(stairs) => onChange({ stairs })} />
      )}
      {spot.door && (
        <label className="flex flex-col gap-1">
          <span className="font-semibold">It leads to</span>
          <select
            value={value}
            onChange={(e) => {
              const [mapId, spotId] = e.target.value.split("/");
              onChange({ leadsTo: e.target.value ? { mapId, spotId } : null });
            }}
            className={field}
          >
            <option value="">Not joined yet</option>
            {rooms.map((room) => (
              <optgroup key={room.id} label={room.name}>
                {room.places.map((place, i) => (
                  <option key={place.id} value={`${room.id}/${place.id}`}>
                    {room.name} – {place.name}
                    {i === 0 ? " (entrance)" : place.via === "lift" ? " (lift)" : place.via === "stairs" ? " (stairs)" : place.door ? " (door)" : ""}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
          {suggestion && (
            <Button variant="secondary" onClick={() => onChange({ leadsTo: { mapId: suggestion.mapId, spotId: suggestion.spotId } })}>
              Join to {suggestion.label}
            </Button>
          )}
          {rooms.length === 0 && <span className="text-muted">Record the other room first, then join the door here.</span>}
        </label>
      )}
      {spot.door && (spot.via ?? "door") === "door" && (
        <label className="flex flex-col gap-1">
          <span className="font-semibold">How does it open?</span>
          <select value={spot.opens ?? ""} onChange={(e) => onChange({ opens: (e.target.value as DoorOpening) || null })} className={field}>
            {openings.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      )}
    </div>
  );
}

function StairsFields({ stairs, onChange }: { stairs: Stairs; onChange: (stairs: Stairs) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="font-semibold">How many steps?</span>
        <input
          type="number"
          inputMode="numeric"
          min={1}
          max={200}
          value={stairs.steps}
          onChange={(e) => onChange({ ...stairs, steps: Math.max(1, Math.min(200, Math.round(Number(e.target.value) || 1))) })}
          className={field}
        />
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">From this room they go</span>
        <select value={stairs.going} onChange={(e) => onChange({ ...stairs, going: e.target.value as Stairs["going"] })} className={field}>
          <option value="up">Up</option>
          <option value="down">Down</option>
        </select>
      </label>
      <label className="flex flex-col gap-1">
        <span className="font-semibold">Handrail, going from this room</span>
        <select value={stairs.handrail} onChange={(e) => onChange({ ...stairs, handrail: e.target.value as Stairs["handrail"] })} className={field}>
          <option value="right">On the right</option>
          <option value="left">On the left</option>
          <option value="both">On both sides</option>
          <option value="none">No handrail</option>
        </select>
      </label>
    </div>
  );
}
