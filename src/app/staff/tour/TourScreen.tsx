"use client";

import { useEffect, useState } from "react";
import { createTour, deleteTour, fetchTours } from "@/core/ai/client";
import { useStaffName } from "@/core/device/store";
import type { DoorRef, FloorMap, Tour } from "@/core/map";
import { useJson } from "@/core/storage/client";
import { Button, LinkButton, LiveRegion, Notice } from "@/core/ui";

const field = "min-h-12 rounded-lg border-2 border-fg bg-bg px-3 text-lg";
const same = (a: DoorRef, b: DoorRef) => a.mapId === b.mapId && a.spotId === b.spotId;

// a colleague picks the stops, the ai writes the welcome, what to say at each stop and a short quiz
export function TourScreen() {
  const result = useJson<FloorMap[]>("/api/maps?published=1");
  const maps = result.status === "ready" ? result.data : [];
  const staffName = useStaffName();
  const [guest, setGuest] = useState("");
  const [stops, setStops] = useState<DoorRef[]>([]);
  const [tours, setTours] = useState<Tour[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetchTours().then(setTours).catch(() => {});
  }, []);

  const nameOf = (ref: DoorRef) => {
    const map = maps.find((m) => m.id === ref.mapId);
    const spot = map?.spots.find((s) => s.id === ref.spotId);
    return spot ? `${spot.name} (${map!.name})` : "a removed place";
  };

  function toggle(ref: DoorRef) {
    setStops((list) => (list.some((r) => same(r, ref)) ? list.filter((r) => !same(r, ref)) : list.length < 8 ? [...list, ref] : list));
  }

  async function create() {
    setBusy(true);
    setMessage("The AI is writing the tour…");
    try {
      const made = await createTour({ guest: guest.trim(), stops, createdBy: staffName ?? "" });
      if (!made.ok) {
        setMessage(made.reason === "ai-off" ? "The AI is not configured, a tour cannot be written." : "The tour could not be made, try again.");
        return;
      }
      setTours((list) => [made.tour, ...list]);
      setStops([]);
      setGuest("");
      setMessage(`The tour for ${made.tour.guest} is ready. On the guided phone they say "start my tour".`);
    } catch (e) {
      setMessage(`The tour could not be made: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  async function remove(id: string) {
    setTours(await deleteTour(id).catch(() => tours));
  }

  return (
    <>
      <LiveRegion message={message} />
      <h1 className="text-3xl font-black">First-day tour</h1>
      <p className="text-lg">
        Choose the places a new colleague should know, in the order of the tour. The AI writes a welcome, what to say at
        each stop and a short spoken quiz at the end. The guided app then leads them from stop to stop.
      </p>
      {result.status === "loading" && <p className="text-lg">Loading…</p>}
      {result.status === "ready" && maps.length === 0 && <Notice>Publish a room first.</Notice>}

      <label className="flex flex-col gap-1">
        <span className="text-lg font-semibold">Name of the new colleague</span>
        <input value={guest} maxLength={60} onChange={(e) => setGuest(e.target.value)} className={field} />
      </label>

      {maps.map((map) => (
        <fieldset key={map.id} className="flex flex-col gap-1 rounded-xl border-2 border-border p-3">
          <legend className="px-1 text-lg font-bold">{map.name}</legend>
          {map.spots
            .filter((s) => s.kind === "place")
            .map((spot) => {
              const ref = { mapId: map.id, spotId: spot.id };
              const order = stops.findIndex((r) => same(r, ref));
              return (
                <label key={spot.id} className="flex min-h-12 items-center gap-3 text-lg">
                  <input type="checkbox" checked={order >= 0} onChange={() => toggle(ref)} className="h-6 w-6" />
                  {spot.name}
                  {order >= 0 && <strong className="ml-auto">stop {order + 1}</strong>}
                </label>
              );
            })}
        </fieldset>
      ))}

      {stops.length > 0 && <p className="text-lg">Tour: {stops.map(nameOf).join(" → ")}</p>}
      <Button onClick={() => void create()} disabled={busy || !guest.trim() || stops.length === 0} className="min-h-16 text-xl">
        {busy ? "Writing the tour…" : "Make the tour"}
      </Button>
      {message && <Notice>{message}</Notice>}

      <section className="flex flex-col gap-3">
        <h2 className="text-2xl font-bold">Tours ({tours.length})</h2>
        {tours.length === 0 && <p className="text-lg">None yet.</p>}
        {tours.map((tour) => (
          <article key={tour.id} className="flex flex-col gap-2 rounded-xl border-2 border-border p-4">
            <h3 className="text-xl font-bold">For {tour.guest}</h3>
            <p className="text-lg">{tour.welcome}</p>
            <ol className="list-decimal pl-6 text-lg">
              {tour.stops.map((ref, i) => (
                <li key={`${ref.mapId}-${ref.spotId}`}>
                  <strong>{nameOf(ref)}</strong>: {tour.stopTexts[i]}
                </li>
              ))}
            </ol>
            {tour.quiz.length > 0 && (
              <div className="text-lg">
                <strong>Quiz</strong>
                <ul className="list-disc pl-6">
                  {tour.quiz.map((q) => (
                    <li key={q.question}>
                      {q.question} <span className="text-muted">({q.expected})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <Button variant="secondary" onClick={() => void remove(tour.id)}>
              Delete this tour
            </Button>
          </article>
        ))}
      </section>

      <LinkButton href="/staff" variant="secondary">
        Back
      </LinkButton>
    </>
  );
}
