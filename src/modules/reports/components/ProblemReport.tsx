"use client";

import { useState } from "react";
import type { FloorMap, Problem } from "@/core/map";
import { Button, LiveRegion, Notice } from "@/core/ui";
import { reportProblem, resolveProblem } from "../lib/client";

const reasons = ["Out of order", "Blocked", "Closed for cleaning", "Other"];

type ProblemReportProps = {
  map: FloorMap;
  problems: Problem[];
  staffName: string;
};

export function ProblemReport({ map, problems, staffName }: ProblemReportProps) {
  const [placeId, setPlaceId] = useState("");
  const [reason, setReason] = useState(reasons[0]);
  const [other, setOther] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const active = problems.filter((p) => p.mapId === map.id && !p.resolved);
  const nameOf = (id: string) => map.spots.find((p) => p.id === id)?.name ?? "Unknown place";

  async function submit() {
    setBusy(true);
    try {
      await reportProblem({
        mapId: map.id,
        placeId,
        reason: reason === "Other" ? other.trim() || "Problem reported" : reason,
        reportedBy: staffName,
      });
      setMessage(`${nameOf(placeId)} is now marked as unavailable. Guided routes avoid it from now on.`);
      setPlaceId("");
      setOther("");
    } catch (e) {
      setMessage(`Could not send the report: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label className="flex flex-col gap-2">
          <span className="text-lg font-semibold">Which place has a problem?</span>
          <select
            required
            value={placeId}
            onChange={(e) => setPlaceId(e.target.value)}
            className="min-h-14 rounded-xl border-2 border-fg bg-bg px-3 text-lg"
          >
            <option value="">Choose a place</option>
            {map.spots.filter((p) => p.kind === "place").map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 text-lg font-semibold">What is wrong?</legend>
          {reasons.map((r) => (
            <label key={r} className="flex min-h-12 items-center gap-3 rounded-lg border-2 border-border px-3 text-lg">
              <input type="radio" name="reason" checked={reason === r} onChange={() => setReason(r)} className="h-6 w-6" />
              {r}
            </label>
          ))}
        </fieldset>
        {reason === "Other" && (
          <label className="flex flex-col gap-2">
            <span className="text-lg font-semibold">Describe it briefly</span>
            <input
              value={other}
              maxLength={120}
              onChange={(e) => setOther(e.target.value)}
              className="min-h-14 rounded-xl border-2 border-fg bg-bg px-3 text-lg"
            />
          </label>
        )}
        <Button type="submit" variant="danger" disabled={busy || !placeId} className="min-h-16 text-xl">
          {busy ? "Sending…" : "Report problem"}
        </Button>
      </form>

      <LiveRegion message={message} />
      {message && <Notice>{message}</Notice>}

      <section aria-labelledby="active-problems" className="flex flex-col gap-3">
        <h2 id="active-problems" className="text-xl font-bold">
          Active problems on this floor ({active.length})
        </h2>
        {active.length === 0 && <p className="text-lg">Nothing reported. Everything works.</p>}
        <ul className="flex flex-col gap-3">
          {active.map((p) => (
            <li key={p.id} className="flex flex-col gap-2 rounded-xl border-2 border-danger p-4">
              <p className="text-lg font-semibold">
                {nameOf(p.placeId)}: {p.reason}
              </p>
              <p className="text-muted">
                Reported by {p.reportedBy || "a colleague"} at{" "}
                {new Date(p.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </p>
              <Button
                variant="secondary"
                onClick={() =>
                  void resolveProblem(p.id)
                    .then(() => setMessage(`${nameOf(p.placeId)} is available again.`))
                    .catch(() => setMessage("Could not save. Try again."))
                }
              >
                Mark as fixed
              </Button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
