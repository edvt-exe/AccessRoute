"use client";

import { useState } from "react";
import { buildReport, type Report } from "@/core/ai/client";
import { doorLinks, type FloorMap } from "@/core/map";
import { useJson } from "@/core/storage/client";
import { BuildingSketch, Button, LinkButton, Notice } from "@/core/ui";

const priorityLabel = { high: "High: can hurt someone", medium: "Medium: slows them down", low: "Low: comfort" };

export function BuildingScreen() {
  const result = useJson<FloorMap[]>("/api/maps?published=1");
  const maps = result.status === "ready" ? result.data : [];
  const links = doorLinks(maps);
  const [report, setReport] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function makeReport() {
    setBusy(true);
    setError("");
    try {
      setReport(await buildReport());
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-3xl font-black">Building map</h1>
      {result.status === "loading" && <p className="text-lg">Loading…</p>}
      {result.status === "error" && <Notice tone="error">{result.error}</Notice>}
      {result.status === "ready" && maps.length === 0 && <Notice>No published rooms yet.</Notice>}
      {maps.length > 0 && (
        <>
          <p className="text-lg">
            Published rooms, joined where a door in one room leads to the other. Green squares are doors that join two rooms.
            Rooms without a joined door are drawn on the side.
          </p>
          <BuildingSketch maps={maps} />
          <section className="flex flex-col gap-2">
            <h2 className="text-2xl font-bold">Doors ({links.length})</h2>
            {links.length === 0 && <p className="text-lg">No doors are joined yet. Mark a place as a door in the review and choose where it leads.</p>}
            <ul className="flex flex-col gap-1 text-lg">
              {links.map(({ a, b }) => (
                <li key={`${a.map.id}-${a.spot.id}`}>
                  {a.map.name}: {a.spot.name} ↔ {b.map.name}: {b.spot.name}
                </li>
              ))}
            </ul>
          </section>

          <section className="flex flex-col gap-3" aria-live="polite">
            <h2 className="text-2xl font-bold">Accessibility report</h2>
            <p className="text-lg">
              The app measures the maps (narrow passages, hazards, doors, places nobody can reach) and the AI writes it up
              for the employer, with a fix for each finding.
            </p>
            <Button onClick={() => void makeReport()} disabled={busy}>
              {busy ? "Writing the report…" : report ? "Write it again" : "Write the accessibility report"}
            </Button>
            {error && <Notice tone="error">{error}</Notice>}
            {report && (
              <article className="flex flex-col gap-3">
                <p className="text-lg">{report.summary}</p>
                {report.items.length === 0 && <p className="text-lg">Nothing to fix was found.</p>}
                {report.items.map((item, i) => (
                  <div key={i} className={`flex flex-col gap-1 rounded-xl border-2 p-3 ${item.priority === "high" ? "border-danger" : "border-border"}`}>
                    <span className="font-semibold">
                      {item.room} · {priorityLabel[item.priority]}
                    </span>
                    <span className="text-lg">{item.finding}</span>
                    {item.why && <span className="text-muted">Why: {item.why}</span>}
                    {item.fix && <span className="text-lg">Fix: {item.fix}</span>}
                  </div>
                ))}
                <Button variant="secondary" onClick={() => window.print()}>
                  Print or save as PDF
                </Button>
              </article>
            )}
          </section>
        </>
      )}
      <LinkButton href="/staff" variant="secondary">
        Back
      </LinkButton>
    </>
  );
}
