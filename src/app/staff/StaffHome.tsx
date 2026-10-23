"use client";

import Link from "next/link";
import { useEffect, useState, useSyncExternalStore } from "react";
import { saveRole, saveStaffName, useStaffName } from "@/core/device/store";
import type { MapSummary } from "@/core/map";
import { usePolledJson } from "@/core/storage/client";
import { Button, LinkButton, LiveRegion, Notice } from "@/core/ui";
import { markRequestDone, useProblems, useRecordingRequests } from "@/modules/reports";

function notify(title: string, body: string) {
  if (typeof Notification !== "undefined" && Notification.permission === "granted") new Notification(title, { body, icon: "/icon.svg" });
}

export function StaffHome() {
  const name = useStaffName();
  const [draftName, setDraftName] = useState("");
  const [alert, setAlert] = useState("");
  const [answered, setAnswered] = useState<NotificationPermission | null>(null);
  const systemPermission = useSyncExternalStore(
    () => () => {},
    () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission),
    () => "unsupported",
  );
  const permission = answered ?? systemPermission;

  useEffect(() => {
    saveRole("staff");
  }, []);

  const maps = usePolledJson<MapSummary[]>("/api/maps", 10000, (next, previous) => {
    if (!previous) return;
    const fresh = next.filter((m) => m.status === "review" && !previous.some((p) => p.id === m.id));
    for (const map of fresh) {
      const text = `${map.createdBy || "A colleague"} recorded “${map.name}”. Please check it.`;
      setAlert(text);
      notify("New map to review", text);
    }
  });
  const requests = useRecordingRequests((next, previous) => {
    if (!previous) return;
    const fresh = next.filter((r) => !r.done && !previous.some((p) => p.id === r.id));
    for (const request of fresh) {
      const text = `A colleague asked for a map: “${request.note}”.`;
      setAlert(text);
      notify("Map requested", text);
    }
  });
  const problems = useProblems(10000);

  if (name === undefined) return <p className="text-lg">Loading…</p>;

  if (!name) {
    return (
      <form
        className="flex flex-col gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (draftName.trim()) saveStaffName(draftName);
        }}
      >
        <h1 className="text-3xl font-black">Welcome to AccessRoute</h1>
        <p className="text-lg">You can record maps of your building and help colleagues who need guidance.</p>
        <label htmlFor="staff-name" className="text-lg font-semibold">
          Your name
        </label>
        <input
          id="staff-name"
          required
          maxLength={60}
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          className="min-h-14 rounded-xl border-2 border-fg bg-bg px-3 text-lg"
        />
        <Button type="submit" className="min-h-16 text-xl">
          Continue
        </Button>
      </form>
    );
  }

  const toReview = (maps ?? []).filter((m) => m.status === "review");
  const published = (maps ?? []).filter((m) => m.status === "published");
  const openRequests = requests.filter((r) => !r.done);
  const activeProblems = (id: string) => problems.filter((p) => p.mapId === id && !p.resolved).length;

  return (
    <>
      <LiveRegion message={alert} />
      <header className="flex items-center justify-between gap-3">
        <h1 className="text-3xl font-black">AccessRoute</h1>
        <span className="text-muted">{name}</span>
      </header>

      {alert && (
        <Notice>
          <span className="flex items-start justify-between gap-3">
            {alert}
            <button type="button" onClick={() => setAlert("")} className="min-h-12 min-w-12 font-bold" aria-label="Dismiss">
              ✕
            </button>
          </span>
        </Notice>
      )}

      <LinkButton href="/staff/record" variant="danger" className="min-h-20 text-2xl">
        ● Record a floor
      </LinkButton>

      {permission === "default" && (
        <Button
          variant="secondary"
          onClick={() => void Notification.requestPermission().then(setAnswered)}
        >
          Turn on notifications
        </Button>
      )}

      <section aria-labelledby="inbox" className="flex flex-col gap-3">
        <h2 id="inbox" className="text-2xl font-bold">
          To check ({toReview.length + openRequests.length})
        </h2>
        {maps === null && <p>Loading…</p>}
        {maps && toReview.length + openRequests.length === 0 && <p className="text-lg">Nothing to check right now.</p>}
        <ul className="flex flex-col gap-3">
          {toReview.map((m) => (
            <li key={m.id}>
              <Link href={`/staff/review/${m.id}`} className="flex min-h-16 flex-col rounded-xl border-2 border-primary p-4 no-underline">
                <span className="text-lg font-bold">New map: {m.name}</span>
                <span className="text-muted">
                  {m.placeCount} places, {m.obstacleCount} obstacles · recorded by {m.createdBy || "a colleague"} · {new Date(m.createdAt).toLocaleString()}
                </span>
              </Link>
            </li>
          ))}
          {openRequests.map((r) => (
            <li key={r.id} className="flex flex-col gap-2 rounded-xl border-2 border-warn-fg bg-warn-bg p-4 text-warn-fg">
              <span className="text-lg font-bold">Map requested: “{r.note}”</span>
              <span>{new Date(r.at).toLocaleString()}</span>
              <Button variant="secondary" onClick={() => void markRequestDone(r.id)}>
                Mark as done
              </Button>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="published" className="flex flex-col gap-3">
        <h2 id="published" className="text-2xl font-bold">
          Published floors ({published.length})
        </h2>
        {maps && published.length === 0 && <p className="text-lg">No floor is published yet.</p>}
        <ul className="flex flex-col gap-3">
          {published.map((m) => (
            <li key={m.id} className="flex flex-col gap-2 rounded-xl border-2 border-border p-4">
              <span className="text-lg font-bold">{m.name}</span>
              <span className="text-muted">
                {m.placeCount} places
                {activeProblems(m.id) > 0 && ` · ${activeProblems(m.id)} active problem${activeProblems(m.id) > 1 ? "s" : ""}`}
              </span>
              <div className="grid grid-cols-2 gap-2">
                <LinkButton href={`/staff/report/${m.id}`} variant="secondary">
                  Report a problem
                </LinkButton>
                <LinkButton href={`/staff/review/${m.id}`} variant="secondary">
                  Open
                </LinkButton>
              </div>
            </li>
          ))}
        </ul>
      </section>

      <Link href="/?reset=1" className="min-h-12 self-start py-3 text-muted underline">
        Use this phone in a different role
      </Link>
    </>
  );
}
