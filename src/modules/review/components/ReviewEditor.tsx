"use client";

/* eslint-disable @next/next/no-img-element -- photos are inline jpegs from the recording */
import { useRef, useState } from "react";
import { bounds, distance, round, setWallLength, type FloorMap, type Spot } from "@/core/map";
import { Button, LinkButton, LiveRegion, Notice, RoomSketch, pointOnSketch, type Frame } from "@/core/ui";
import { deleteMap, saveMap } from "../lib/client";

type ReviewEditorProps = {
  initial: FloorMap;
  blockedIds: string[];
  onDeleted: () => void;
};

const field = "min-h-12 rounded-lg border-2 border-fg bg-bg px-3 text-lg";
const sizes = [
  { radius: 0.3, label: "Small" },
  { radius: 0.6, label: "Medium" },
  { radius: 1, label: "Large" },
];
const nudge = 0.25; // metres per arrow press

function timeLabel(seconds: number) {
  return `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, "0")}`;
}

export function ReviewEditor({ initial, blockedIds, onDeleted }: ReviewEditorProps) {
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

      <section className="flex flex-col gap-4">
        <h2 className="text-2xl font-bold">Walls ({map.outline.length})</h2>
        <p className="text-lg">
          Steps are only an estimate. Measure or pace the walls and type the real lengths, the corners stay square and the
          room stays closed. Wall 1 starts at the entrance and they follow the walk.
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
                <img src={spot.photo} alt={`What the camera saw at ${spot.name}`} className="max-h-40 rounded-lg object-cover" />
                <label className="flex flex-col gap-1">
                  <span className="font-semibold">Name</span>
                  <input value={spot.name} maxLength={60} onChange={(e) => updateSpot(spot.id, { name: e.target.value })} className={field} />
                </label>
                {spot.kind === "obstacle" && (
                  <label className="flex flex-col gap-1">
                    <span className="font-semibold">Size</span>
                    <select
                      value={spot.radius}
                      onChange={(e) => updateSpot(spot.id, { radius: Number(e.target.value) })}
                      className={field}
                    >
                      {sizes.map((s) => (
                        <option key={s.radius} value={s.radius}>
                          {s.label}
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
