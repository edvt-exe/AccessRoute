"use client";

import { useEffect, useRef, useState } from "react";
import { clampInside, defaultStepLength, describeTurn, distance, turnAngle, type FloorMap, type Point, type Spot } from "@/core/map";
import { requestMotionPermission } from "@/core/sensors/heading";
import { createTracker, type Tracker } from "@/core/sensors/tracker";
import { beep, canListen, listenOnce, speak, stopSpeaking, unlockAudio } from "@/core/speech/speech";
import { closeCamera, openCamera } from "@/core/storage/camera";
import { captureVideoFrame } from "@/core/storage/image";
import { locateOnMap } from "../lib/client";
import { matchPlace } from "../lib/match";
import { legSentence, planPath, warningSentence, whereAmI, type Leg } from "../lib/plan";

export type Blocked = { ids: string[]; reasons: Record<string, string> };

type GuideAppProps = {
  maps: FloorMap[];
  testMapName?: string;
  getBlocked: (mapId: string) => Promise<Blocked>;
  onRequestRecording: (note: string) => Promise<void>;
};

type Screen = "home" | "typing" | "busy" | "look" | "start" | "guiding" | "manual" | "arrived";

type Trip = {
  map: FloorMap;
  destination: Spot;
  legs: Leg[];
  index: number;
  facing: number | null; // used when the phone has no gyroscope
  looks: number; // camera attempts so far
};

type Seen = { position: Point; facing: number; intro: string } | "ai-off" | "not-found";

const maxLooks = 4;

const stepLength = defaultStepLength;
const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function GuideApp({ maps, testMapName, getBlocked, onRequestRecording }: GuideAppProps) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const tracker = useRef<Tracker | null>(null);
  const run = useRef(0);
  const trip = useRef<Trip | null>(null);
  const timers = useRef<number[]>([]);
  const lastSpoken = useRef("");
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);

  const [screen, setScreen] = useState<Screen>("home");
  const [status, setStatus] = useState("");
  const [typed, setTyped] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [legInfo, setLegInfo] = useState<{ heading: number; metres: number } | null>(null);

  const places = maps.flatMap((map) => map.spots.filter((s) => s.kind === "place").map((place) => ({ map, place })));

  useEffect(
    () => () => {
      run.current++;
      timers.current.forEach((t) => window.clearInterval(t));
      tracker.current?.stop();
      closeCamera(stream.current);
      stopSpeaking();
    },
    [],
  );

  function clearTimers() {
    timers.current.forEach((t) => {
      window.clearTimeout(t);
      window.clearInterval(t);
    });
    timers.current = [];
  }

  function newRun() {
    run.current++;
    clearTimers();
    return run.current;
  }

  async function say(text: string, remember = false) {
    setStatus(text);
    if (remember) lastSpoken.current = text;
    await speak(text);
  }

  function stopCamera() {
    closeCamera(stream.current);
    stream.current = null;
    setCameraOn(false);
  }

  function endTrip() {
    trip.current = null;
    tracker.current?.pause();
    stopCamera();
    void wakeLock.current?.release().catch(() => {});
    wakeLock.current = null;
  }

  function goHome() {
    endTrip();
    setScreen("home");
  }

  // sensors have to be switched on from a tap on ios
  function prepareSensors() {
    unlockAudio();
    void requestMotionPermission();
    tracker.current ??= createTracker({ stepLength });
    // nobody walks before the first instruction, startLeg switches counting on
    tracker.current.pause();
    const keepAwake = (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    keepAwake?.request("screen").then((lock) => (wakeLock.current = lock)).catch(() => {});
  }

  // camera recognition only helps when the ai is configured, otherwise the server answers ai-off
  async function cameraLocate(map: FloorMap): Promise<Seen> {
    try {
      if (!stream.current && video.current) {
        setCameraOn(true);
        stream.current = await openCamera(video.current);
      }
    } catch {
      setCameraOn(false);
      return "ai-off";
    }
    await wait(1000);
    const v = video.current;
    const frames: string[] = [];
    for (let i = 0; i < 2 && v; i++) {
      const frame = captureVideoFrame(v, 512, 0.7);
      if (frame) frames.push(frame);
      if (i === 0) await wait(500);
    }
    const result = frames.length ? await locateOnMap(map.id, frames) : null;
    if (!result || !result.ok) return result?.reason === "ai-off" || result?.reason === "no-map" ? "ai-off" : "not-found";
    const near = result.nearSpotId
      ? map.spots.find((s) => s.id === result.nearSpotId)
      : map.spots.find((s) => distance(s, result.position) < 1.5);
    return { position: result.position, facing: result.facing, intro: near ? `You are near ${near.name}.` : "I found where you are." };
  }

  // the camera knows the room: from where the person stands and which way they face, straight into the route
  async function locateAndStart(id: number) {
    const t = trip.current;
    const tr = tracker.current;
    if (!t || !tr) return;
    setScreen("busy");
    setStatus("Looking around…");
    t.looks++;
    const seen = await cameraLocate(t.map);
    if (id !== run.current) return;
    if (typeof seen === "object") {
      stopCamera();
      tr.setPosition(seen.position);
      tr.anchor(seen.facing);
      t.facing = seen.facing;
      await startFrom(id, seen.position, seen.intro);
      return;
    }
    if (seen === "not-found" && t.looks < maxLooks) {
      // another direction shows other things, usually enough to be recognised
      await say("I do not recognise this spot yet. Hold the phone upright, turn slowly about a quarter to your right, then tap the screen.", true);
      if (id === run.current) setScreen("look");
      return;
    }
    stopCamera();
    // without recognition everybody starts where the map was recorded from: the entrance, facing into the room
    await say(
      seen === "ai-off"
        ? `Stand at ${t.map.spots[0].name}, facing into the room. Then tap the screen.`
        : `I still cannot tell where you are. Please ask a colleague to bring you to ${t.map.spots[0].name}. Face into the room there and tap the screen.`,
      true,
    );
    if (id === run.current) setScreen("start");
  }

  // step 1: ask where to go
  async function askDestination() {
    const id = newRun();
    prepareSensors();
    if (places.length === 0) {
      await say("There is no map of this building yet. Use the second button to ask a colleague to record one.");
      return;
    }
    setScreen("busy");
    await say("Where do you want to go? Say the name of the place after the tone.");
    if (id !== run.current) return;
    if (!canListen()) {
      setScreen("typing");
      setStatus("Voice input is not available in this browser. Type the place instead.");
      return;
    }
    beep();
    setStatus("Listening…");
    const heard = await listenOnce();
    if (id !== run.current) return;
    if (!heard.ok) {
      await say(
        heard.reason === "denied"
          ? "I cannot use the microphone. Allow the microphone for this site, then try again."
          : "I did not hear anything. Tap the big button and try again.",
      );
      setScreen("home");
      return;
    }
    await chooseDestination(heard.text, id);
  }

  async function chooseDestination(text: string, id: number) {
    const match = matchPlace(text, places.map((p) => p.place));
    const found = match && places.find((p) => p.place === match.place);
    if (!found) {
      const names = [...new Set(places.map((p) => p.place.name))].slice(0, 10).join(", ");
      await say(`I heard "${text}", but I do not know that place. You can say: ${names}.`);
      setScreen("home");
      return;
    }
    const { map, place: destination } = found;
    const blocked = await getBlocked(map.id).catch((): Blocked => ({ ids: [], reasons: {} }));
    if (id !== run.current) return;
    if (blocked.ids.includes(destination.id)) {
      await say(`${destination.name} is not available right now: ${blocked.reasons[destination.id] ?? "a colleague reported a problem"}. Please ask a colleague for help.`);
      setScreen("home");
      return;
    }
    const t: Trip = { map, destination, legs: [], index: 0, facing: 0, looks: 0 };
    trip.current = t;
    // the person cannot walk through walls, so the measured position stays inside the room
    tracker.current?.constrain((p) => clampInside(p, map.outline, 0.25));
    await say(`Going to ${destination.name}.`);
    if (id !== run.current) return;

    await locateAndStart(id);
  }

  async function startAtEntrance() {
    const id = newRun();
    const t = trip.current;
    if (!t) return;
    tracker.current?.anchor(0);
    tracker.current?.setPosition({ x: 0, y: 0 });
    t.facing = 0;
    await startFrom(id, { x: 0, y: 0 }, "");
  }

  // step 2: the shortest way around the obstacles, from wherever the person is
  async function startFrom(id: number, from: Point, intro: string) {
    const t = trip.current;
    if (!t) return;
    const blocked = await getBlocked(t.map.id).catch((): Blocked => ({ ids: [], reasons: {} }));
    if (id !== run.current) return;
    const plan = planPath(t.map, from, t.destination.id, blocked.ids);
    if (!plan.ok) {
      if (plan.reason === "already-there") {
        await arrived(id);
        return;
      }
      const reason =
        plan.reason === "destination-blocked"
          ? `${t.destination.name} has just been reported as not available.`
          : `I cannot find a way to ${t.destination.name} around the obstacles.`;
      await say(`${intro} ${reason} Please ask a colleague for help.`.trim());
      goHome();
      return;
    }
    t.legs = plan.legs;
    t.index = 0;
    await startLeg(id, intro);
  }

  // step 3: one instruction at a time. moving: the person keeps walking into this leg without stopping
  async function startLeg(id: number, intro = "", moving = false) {
    const t = trip.current;
    const tr = tracker.current;
    if (!t || !tr) return;
    const leg = t.legs[t.index];
    const last = t.index === t.legs.length - 1;
    const facing = tr.hasHeading ? tr.heading : t.facing;
    const text = [intro, legSentence(leg, facing, last, t.destination.name, stepLength)].filter(Boolean).join(" ");
    setLegInfo({ heading: Math.round(leg.heading), metres: Math.round(leg.metres * 100) / 100 });
    setScreen("guiding");
    // standing while listening and turning makes the phone bounce, those bounces are not steps
    if (!moving) tr.pause();
    await say(text, true);
    if (id !== run.current) return;

    if (!tr.hasMotion) {
      await say("I cannot count your steps on this phone. Tap the screen when you have done it.");
      if (id === run.current) setScreen("manual");
      return;
    }
    if (tr.heading !== null && Math.abs(turnAngle(tr.heading, leg.heading)) > 25) {
      await waitUntilFacing(id, leg.heading);
      if (id !== run.current) return;
    }
    // walking mode for the whole leg: a person who pauses half way still has the rest of it counted
    if (!moving) tr.expectWalk();
    follow(id, leg);
  }

  // with the gyroscope the person hears a tone once they face the right way
  async function waitUntilFacing(id: number, target: number) {
    const started = Date.now();
    while (id === run.current && Date.now() - started < 12000) {
      const heading = tracker.current?.heading;
      if (heading != null && Math.abs(turnAngle(heading, target)) < 20) {
        beep(1200, 120);
        await say("Good. Now walk.");
        return;
      }
      await wait(200);
    }
  }

  function follow(id: number, leg: Leg) {
    const tr = tracker.current!;
    const startSteps = tr.steps;
    const announced = new Set<string>();
    let off = 0;
    let lastHint = 0;
    const watch = window.setInterval(() => {
      if (id !== run.current) return;
      const walkedMetres = (tr.steps - startSteps) * stepLength;
      for (const warning of leg.warnings) {
        if (announced.has(warning.spot.id) || walkedMetres < warning.atMetres - 1.2) continue;
        announced.add(warning.spot.id);
        void speak(warningSentence(warning, stepLength, walkedMetres));
      }
      const heading = tr.heading;
      if (heading !== null) {
        const delta = turnAngle(heading, leg.heading);
        off = Math.abs(delta) > 35 ? off + 1 : 0;
        if (off >= 12 && Date.now() - lastHint > 6000) {
          lastHint = Date.now();
          off = 0;
          void speak(delta > 0 ? "Bear right a little." : "Bear left a little.");
        }
      }
      if (walkedMetres >= leg.metres - stepLength * 0.5) {
        clearTimers();
        void legDone(id);
      }
    }, 250);
    timers.current.push(watch);
  }

  async function legDone(id: number) {
    const t = trip.current;
    if (!t || id !== run.current) return;
    const leg = t.legs[t.index];
    // assume the person followed the instruction, this stops sensor drift from adding up
    tracker.current?.setPosition(leg.to);
    t.facing = leg.heading;
    if (t.index === t.legs.length - 1) {
      await arrived(id);
      return;
    }
    t.index++;
    // stopping only matters when a turn follows
    const next = t.legs[t.index];
    const facing = tracker.current?.heading ?? t.facing;
    const sharp = facing !== null && describeTurn(turnAngle(facing, next.heading)) !== null;
    await startLeg(id, sharp ? "Stop." : "Keep going.", !sharp);
  }

  // "check where you are": the measured position, corrected by the camera when the ai is on
  async function checkWhere() {
    const id = newRun();
    const t = trip.current;
    const tr = tracker.current;
    if (!t || !tr) return;
    setScreen("busy");
    tr.pause();
    await say("Checking where you are. Stand still.");
    if (id !== run.current) return;
    const seen = await cameraLocate(t.map);
    stopCamera();
    if (id !== run.current) return;
    if (typeof seen === "object") {
      tr.setPosition(seen.position);
      tr.anchor(seen.facing);
    }
    const position = tr.position;
    await say(whereAmI(t.map, position, t.destination, tr.heading ?? t.facing, stepLength));
    if (id !== run.current) return;
    await startFrom(id, position, "From here:");
  }

  async function manualDone() {
    const id = newRun();
    await legDone(id);
  }

  async function arrived(id: number) {
    const t = trip.current;
    clearTimers();
    endTrip();
    setScreen("arrived");
    beep(880, 150);
    window.setTimeout(() => beep(1320, 200), 220);
    if (id === run.current) await say(`You have arrived at ${t?.destination.name ?? "your destination"}.`, true);
  }

  async function requestMap() {
    const id = newRun();
    unlockAudio();
    setScreen("busy");
    let note = "";
    if (canListen()) {
      await say("After the tone, say which room or floor you need a map for.");
      if (id !== run.current) return;
      beep();
      setStatus("Listening…");
      const heard = await listenOnce();
      if (id !== run.current) return;
      if (heard.ok) note = heard.text;
    }
    try {
      await onRequestRecording(note);
      await say("Thank you. Your colleagues have been asked to record it. You can use it as soon as they have checked it.");
    } catch {
      await say("I could not send the request. Check the internet connection and try again.");
    }
    if (id === run.current) setScreen("home");
  }

  function stop() {
    newRun();
    stopSpeaking();
    goHome();
    void say("Stopped.");
  }

  function mainTap() {
    if (screen === "start") void startAtEntrance();
    else if (screen === "look") void locateAndStart(newRun());
    else if (screen === "guiding") void checkWhere();
    else if (screen === "manual") void manualDone();
  }

  const huge = "w-full rounded-3xl border-4 p-6 text-center font-black leading-tight";
  const tapHint = { start: "Tap when you are ready", look: "Tap when you have turned", guiding: "Tap to check where you are", manual: "Tap when you have done it" } as const;

  return (
    <div
      className="flex min-h-[calc(100dvh-7rem)] flex-col gap-4"
      data-screen={screen}
      data-leg-heading={legInfo?.heading}
      data-leg-metres={legInfo?.metres}
    >
      {/* frames are read from this video; ios can return black frames from a video that is not on screen */}
      <video
        ref={video}
        muted
        playsInline
        aria-hidden="true"
        className={cameraOn ? "mx-auto aspect-[3/4] h-[30dvh] rounded-2xl bg-black object-cover" : "hidden"}
      />
      {testMapName && <p className="rounded-lg bg-warn-bg p-2 text-center font-semibold text-warn-fg">Test mode: {testMapName}</p>}

      {screen === "home" && (
        <>
          <button type="button" onClick={() => void askDestination()} className={`${huge} min-h-[55dvh] border-primary bg-primary text-4xl text-primary-fg`}>
            Where do you want to go?
          </button>
          <button type="button" onClick={() => void requestMap()} className={`${huge} min-h-[20dvh] border-fg bg-bg text-2xl`}>
            Ask for a map to be recorded
          </button>
          {status && <p className="text-center text-lg text-muted">{status}</p>}
        </>
      )}

      {screen === "typing" && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const id = newRun();
            setScreen("busy");
            void chooseDestination(typed, id);
          }}
        >
          <p className="text-xl">{status}</p>
          <label htmlFor="destination" className="text-2xl font-bold">
            Where do you want to go?
          </label>
          <input
            id="destination"
            autoFocus
            list="destinations"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="min-h-16 rounded-xl border-4 border-fg bg-bg px-4 text-2xl"
          />
          <datalist id="destinations">
            {places.map(({ map, place }) => (
              <option key={`${map.id}-${place.id}`} value={place.name} />
            ))}
          </datalist>
          <button type="submit" className={`${huge} border-primary bg-primary text-3xl text-primary-fg`}>
            Go
          </button>
          <button type="button" onClick={goHome} className={`${huge} border-fg text-2xl`}>
            Back
          </button>
        </form>
      )}

      {screen === "busy" && (
        <div className={`${huge} flex min-h-[45dvh] items-center justify-center border-border text-3xl`}>
          <p>{status}</p>
        </div>
      )}

      {(screen === "start" || screen === "look" || screen === "guiding" || screen === "manual") && (
        <button type="button" onClick={mainTap} className={`${huge} flex min-h-[45dvh] flex-col items-center justify-center gap-6 border-primary text-3xl`}>
          <span>{status}</span>
          <span className="text-xl font-semibold text-muted">{tapHint[screen]}</span>
        </button>
      )}

      {screen === "arrived" && (
        <>
          <div className={`${huge} flex min-h-[45dvh] items-center justify-center border-ok text-4xl`}>
            <p>{status}</p>
          </div>
          <button type="button" onClick={() => void askDestination()} className={`${huge} min-h-[20dvh] border-primary bg-primary text-3xl text-primary-fg`}>
            Go somewhere else
          </button>
        </>
      )}

      {(screen === "start" || screen === "look" || screen === "guiding" || screen === "manual" || screen === "busy") && (
        <div className="grid grid-cols-2 gap-4">
          <button type="button" onClick={() => void speak(lastSpoken.current || status)} className={`${huge} min-h-24 border-fg text-2xl`}>
            Repeat
          </button>
          <button type="button" onClick={stop} className={`${huge} min-h-24 border-danger bg-danger text-2xl text-danger-fg`}>
            Stop
          </button>
        </div>
      )}
    </div>
  );
}
