"use client";

import { useEffect, useRef, useState } from "react";
import { requestMotionPermission } from "@/core/sensors/heading";
import { StepCounter, sampleFrom, watchMotion, type RawMotion } from "@/core/sensors/steps";
import { maxTraceSamples, traceScenarios, type SensorTrace, type TraceScenario } from "@/core/sensors/trace";
import { Button, LiveRegion, Notice } from "@/core/ui";
import { downloadTrace, uploadTrace } from "../lib/client";

type Phase = "setup" | "recording" | "result" | "saved";

type Live = { seconds: number; samples: number; steps: number };

const maxSeconds = 180;
const fixed = (value: number, digits: number) => Math.round(value * 10 ** digits) / 10 ** digits;

// records what the motion sensors report while a team member stands, types, turns or walks, and what the
// step counter makes of it. saved traces become test cases, so the counter is tuned on real phones
export function SensorLab() {
  const samples = useRef<RawMotion[]>([]);
  const counter = useRef<StepCounter | null>(null);
  const steps = useRef(0);
  const startedAt = useRef(0);
  const recordedAt = useRef("");
  const stopWatching = useRef<(() => void) | null>(null);
  const timer = useRef<number | null>(null);
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);

  const [phase, setPhase] = useState<Phase>("setup");
  const [scenario, setScenario] = useState<TraceScenario>("still");
  const [live, setLive] = useState<Live>({ seconds: 0, samples: 0, steps: 0 });
  const [expected, setExpected] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedTo, setSavedTo] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(
    () => () => {
      stopWatching.current?.();
      if (timer.current !== null) window.clearInterval(timer.current);
      void wakeLock.current?.release().catch(() => {});
    },
    [],
  );

  function snapshot(): Live {
    return { seconds: (performance.now() - startedAt.current) / 1000, samples: samples.current.length, steps: steps.current };
  }

  async function start() {
    // asked first, still inside the tap, ios refuses the prompt otherwise
    const allowed = requestMotionPermission();
    const keepAwake = (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    keepAwake?.request("screen").then((lock) => (wakeLock.current = lock)).catch(() => {});

    samples.current = [];
    counter.current = new StepCounter();
    steps.current = 0;
    startedAt.current = performance.now();
    recordedAt.current = new Date().toISOString();
    setError("");
    setLive({ seconds: 0, samples: 0, steps: 0 });

    stopWatching.current = watchMotion(([t, ax, ay, az, alpha, beta, gamma]) => {
      // rounded and counted from the start of the recording, which keeps the file small
      const reading: RawMotion = [fixed(t - startedAt.current, 1), fixed(ax, 3), fixed(ay, 3), fixed(az, 3), fixed(alpha, 2), fixed(beta, 2), fixed(gamma, 2)];
      samples.current.push(reading);
      steps.current += counter.current!.push(sampleFrom(reading));
      if (samples.current.length >= maxTraceSamples) stop();
    });
    timer.current = window.setInterval(() => {
      const now = snapshot();
      setLive(now);
      if (now.seconds >= maxSeconds) stop();
      else if (now.seconds >= 2 && now.samples === 0) setError("No motion readings arrive. This phone or browser may not have motion sensors, or access was refused.");
    }, 500);

    setPhase("recording");
    setMessage(`Recording: ${traceScenarios[scenario].label}.`);
    if (!(await allowed)) setError("Motion access was refused. Allow motion and orientation for this site in the browser settings.");
  }

  function stop() {
    stopWatching.current?.();
    stopWatching.current = null;
    if (timer.current !== null) window.clearInterval(timer.current);
    timer.current = null;
    void wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;

    const final = snapshot();
    setLive(final);
    setExpected(traceScenarios[scenario].walking ? "" : "0");
    setPhase("result");
    setMessage(`Stopped. The step counter found ${final.steps} steps.`);
  }

  function trace(): SensorTrace {
    return {
      version: 1,
      scenario,
      note: note.trim(),
      expectedSteps: Number(expected),
      device: navigator.userAgent.slice(0, 300),
      recordedAt: recordedAt.current,
      samples: samples.current,
    };
  }

  async function save() {
    setSaving(true);
    setError("");
    try {
      const result = await uploadTrace(trace());
      setSavedTo(result.savedTo);
      setPhase("saved");
      setMessage("Saved.");
    } catch (e) {
      setError(`Saving failed: ${(e as Error).message}. You can download the file instead.`);
    } finally {
      setSaving(false);
    }
  }

  function restart() {
    samples.current = [];
    setNote("");
    setSavedTo("");
    setError("");
    setPhase("setup");
  }

  const walking = traceScenarios[scenario].walking;
  const expectedValid = /^\d{1,4}$/.test(expected);
  const enoughSamples = live.samples >= 10;
  const rate = live.seconds > 0 ? Math.round(live.samples / live.seconds) : 0;

  return (
    <div className="flex flex-col gap-4">
      <LiveRegion message={message} />
      {error && <Notice tone="error">{error}</Notice>}

      {phase === "setup" && (
        <>
          <p className="text-lg">
            Hold the phone the way you hold it when using the app. Press start, do one thing for about 30 seconds, then press stop.
            When walking, count your steps out loud.
          </p>
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-2 text-xl font-bold">What will you do?</legend>
            {(Object.keys(traceScenarios) as TraceScenario[]).map((key) => (
              <label key={key} className="flex min-h-12 items-center gap-3 rounded-xl border-2 border-border px-4 py-2 text-lg">
                <input type="radio" name="scenario" value={key} checked={scenario === key} onChange={() => setScenario(key)} className="size-5" />
                {traceScenarios[key].label}
              </label>
            ))}
          </fieldset>
          <Button onClick={() => void start()}>Start recording</Button>
        </>
      )}

      {phase === "recording" && (
        <>
          <p className="text-xl font-bold">{traceScenarios[scenario].label}</p>
          <dl className="grid grid-cols-2 gap-3 text-lg">
            <dt className="text-muted">Time</dt>
            <dd className="font-mono">{Math.floor(live.seconds)} s</dd>
            <dt className="text-muted">Readings</dt>
            <dd className="font-mono">
              {live.samples} ({rate}/s)
            </dd>
            <dt className="text-muted">Steps found</dt>
            <dd className="font-mono text-3xl font-black">{live.steps}</dd>
          </dl>
          <Button variant="danger" onClick={stop}>
            Stop
          </Button>
        </>
      )}

      {phase === "result" && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (expectedValid && enoughSamples) void save();
          }}
        >
          <p className="text-lg">
            The step counter found <strong>{live.steps}</strong> steps in {Math.round(live.seconds)} s ({live.samples} readings, {rate} per second).
          </p>
          {!enoughSamples && <Notice tone="warn">Too few readings were recorded to save this.</Notice>}
          {walking ? (
            <label className="flex flex-col gap-2 text-lg font-semibold">
              How many steps did you really take?
              <input
                inputMode="numeric"
                value={expected}
                onChange={(e) => setExpected(e.target.value.replace(/\D/g, ""))}
                className="min-h-12 rounded-xl border-2 border-fg bg-bg px-4 text-xl"
                autoFocus
              />
            </label>
          ) : (
            <p className="text-lg">You were standing, so the right answer is 0 steps.</p>
          )}
          <label className="flex flex-col gap-2 text-lg font-semibold">
            Note (optional)
            <input
              value={note}
              maxLength={120}
              onChange={(e) => setNote(e.target.value)}
              placeholder="for example: phone in the left hand, carpet"
              className="min-h-12 rounded-xl border-2 border-fg bg-bg px-4 text-lg"
            />
          </label>
          <Button type="submit" disabled={!expectedValid || !enoughSamples || saving}>
            {saving ? "Saving…" : "Save for the tests"}
          </Button>
          <Button variant="secondary" disabled={!expectedValid || !enoughSamples} onClick={() => downloadTrace(trace(), `${scenario}-${recordedAt.current.slice(0, 19)}`)}>
            Download the file
          </Button>
          <Button variant="secondary" onClick={restart}>
            Discard
          </Button>
        </form>
      )}

      {phase === "saved" && (
        <>
          <Notice>
            Saved to <span className="break-all font-mono text-base">{savedTo}</span>
          </Notice>
          <Button onClick={restart}>Record another</Button>
        </>
      )}
    </div>
  );
}
