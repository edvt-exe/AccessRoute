"use client";

import { useEffect, useRef, useState } from "react";
import { askAssistant, createTour, describeView, fetchTours, judgeAnswer, phraseInstructions } from "@/core/ai/client";
import { readLastRoom, saveLastRoom, useGuestName, useStepProfile } from "@/core/device/store";
import { afterDoor, changesFloor, clampInside, describeTurn, doorLinks, floorName, roomRoute, turnAngle, type FloorMap, type Hop, type Point, type Spot, type Tour } from "@/core/map";
import { requestMotionPermission } from "@/core/sensors/heading";
import { createTracker, type Tracker } from "@/core/sensors/tracker";
import { beep, canListen, isSpeaking, listenOnce, speak, stopSpeaking, unlockAudio } from "@/core/speech/speech";
import { closeCamera, isWideCamera, openCamera } from "@/core/storage/camera";
import { LiveRegion } from "@/core/ui";
import { captureVideoFrame } from "@/core/storage/image";
import { matchPlace } from "../lib/match";
import { describePosition, isCheckpoint, legSentence, planAlongWalls, planPath, stepsText, warningSentence, whereAmI, type Leg } from "../lib/plan";

// places reported out of order, and things in the way for a while (wet floor, boxes)
export type Blocked = { ids: string[]; reasons: Record<string, string>; obstacles?: Spot[] };

type GuideAppProps = {
  maps: FloorMap[];
  testMapName?: string;
  getBlocked: (mapId: string) => Promise<Blocked>;
  onRequestRecording: (note: string) => Promise<void>;
  onHelp?: () => void; // plays the tutorial again
};

type Screen = "home" | "typing" | "busy" | "start" | "guiding" | "checkpoint" | "manual" | "door" | "arrived";

type Trip = {
  map: FloorMap; // the room the person is in now
  destination: Spot;
  destinationMap: FloorMap;
  target: Spot; // where the walk in this room ends: the next door, or the destination
  hops: Hop[]; // doors still to go through
  phrases?: (string | null)[]; // the ai's wording of each stretch, null where the plain sentence is used
  templates?: string[]; // the plain sentences the ai worded, for the direction the person was expected to face
  legs: Leg[];
  index: number;
  facing: number | null; // used when the phone has no gyroscope
};



// what to do in a lift or on stairs, where the app cannot guide: the person taps when they are out on the new floor
function floorChange(spot: Spot, next: FloorMap) {
  const floor = floorName(next);
  if (spot.via === "lift") {
    return `You are at ${spot.name}. Enter the lift and press the button for ${floor}. When the doors open on ${floor}, step out, take one more step and tap the top half.`;
  }
  const stairs = spot.stairs;
  if (!stairs) return `You are at ${spot.name}, stairs to ${floor}. Hold the handrail and take them one step at a time. At the end, take one more step and tap the top half.`;
  const rail =
    stairs.handrail === "both" ? "handrails on both sides" : stairs.handrail === "none" ? "no handrail, take extra care" : `handrail on your ${stairs.handrail}`;
  const end = stairs.going === "up" ? "top" : "bottom";
  return `You are at ${spot.name}. Stairs going ${stairs.going} to ${floor}, ${rail}, about ${stairs.steps} steps. Take them one at a time. At the ${end}, take one more step and tap the top half.`;
}

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export function GuideApp({ maps, testMapName, getBlocked, onRequestRecording, onHelp }: GuideAppProps) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const tracker = useRef<Tracker | null>(null);
  const run = useRef(0);
  const trip = useRef<Trip | null>(null);
  const timers = useRef<number[]>([]);
  const lastSpoken = useRef("");
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const tour = useRef<{ tour: Tour; index: number } | null>(null);
  const lastArrived = useRef<{ map: FloorMap; spot: Spot } | null>(null);

  const [screen, setScreen] = useState<Screen>("home");
  const [status, setStatus] = useState("");
  const [typed, setTyped] = useState("");
  const [cameraOn, setCameraOn] = useState(false);
  const [legInfo, setLegInfo] = useState<{ heading: number; metres: number } | null>(null);
  const [checkpointLabel, setCheckpointLabel] = useState("Tap when you reach the corner");

  // the person's own step, from the calibration in the tutorial; a counted step can be a little more or less than one
  const profile = useStepProfile();
  // the person's own name, said now and then so the guide speaks to them and not at them
  const guest = useGuestName() ?? "";
  const named = (text: string) => (guest ? text.replace("{name}", guest) : text.replace(/,? ?\{name\}/, ""));
  const stepLength = profile.length;
  const places = maps.flatMap((map) => map.spots.filter((s) => s.kind === "place").map((place) => ({ map, place })));
  const roomOf = (id: string) => maps.find((m) => m.id === id);

  // the rooms joined to this one by doors, the person can only be in one of them
  function reachable(map: FloorMap) {
    const links = doorLinks(maps);
    const found = [map];
    for (let i = 0; i < found.length && found.length < 8; i++) {
      for (const { a, b } of links) {
        const next = a.map.id === found[i].id ? b.map : b.map.id === found[i].id ? a.map : null;
        if (next && !found.includes(next)) found.push(next);
      }
    }
    return found;
  }

  function enterRoom(t: Trip, map: FloorMap) {
    t.map = map;
    // the person cannot walk through walls, so the measured position stays inside the room
    tracker.current?.constrain((p) => clampInside(p, map.outline, 0.25));
  }

  function targetName(t: Trip) {
    const next = t.hops[0] && roomOf(t.hops[0].to.mapId);
    return next ? `the door to ${next.name}` : t.destination.name;
  }

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
    tracker.current ??= createTracker({ stepLength: profile.length * profile.factor });
    const keepAwake = (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    keepAwake?.request("screen").then((lock) => (wakeLock.current = lock)).catch(() => {});
  }

  // every walk starts at a point the map knows exactly: where the last trip ended, or the entrance
  async function locateAndStart(id: number) {
    const t = trip.current;
    const tr = tracker.current;
    if (!t || !tr) return;
    const last = lastArrived.current;
    if (last && reachable(t.destinationMap).some((m) => m.id === last.map.id)) {
      enterRoom(t, last.map);
      const start = clampInside(last.spot, last.map.outline, 0.3);
      tr.setPosition(start);
      t.facing = tr.heading ?? 0;
      await startFrom(id, start, `Starting from ${last.spot.name}.`);
      return;
    }
    await startAtEntrance(id);
  }

  async function startAtEntrance(id: number) {
    const t = trip.current;
    if (!t) return;
    // the entrance of the room where the last trip ended, if it is joined to the destination, else of the destination's room
    const last = roomOf(readLastRoom() ?? "");
    enterRoom(t, last && reachable(t.destinationMap).includes(last) ? last : t.destinationMap);
    const entrance = `${t.map.spots[0].name}${t.map.id !== t.destinationMap.id || maps.length > 1 ? ` of ${t.map.name}` : ""}`;
    await say(`Stand at ${entrance}, facing into the room. Then tap the top half of the screen.`, true);
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
    await say("Where do you want to go? After the tone, say a place, or ask, for example: where can I get coffee?");
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
    if (onHelp && /^\s*(help|tutorial)\b/i.test(text)) {
      newRun();
      onHelp();
      return;
    }
    // "start the first-day tour" works without the ai, so the tour always starts
    if (/\btour\b/i.test(text)) {
      setScreen("busy");
      await startTour(id);
      return;
    }
    // the assistant understands what the person needs ("where can I get coffee?"), name matching is the fallback
    setScreen("busy");
    const asked = await askAssistant(text).catch(() => null);
    if (id !== run.current) return;
    let found: { map: FloorMap; place: Spot } | undefined;
    let said = "";
    if (asked?.ok) {
      if (asked.intent === "go") {
        found = places.find((p) => p.map.id === asked.mapId && p.place.id === asked.spotId);
        said = asked.say;
      } else if (asked.intent === "help" && onHelp) {
        newRun();
        onHelp();
        return;
      } else if (asked.intent === "look") {
        await describeAhead(id);
        return;
      } else if (asked.intent === "tour") {
        await startTour(id, asked.tourId);
        return;
      } else if (asked.intent === "answer") {
        await say(`${asked.say} To go somewhere, tap the top half again.`);
        if (id === run.current) setScreen("home");
        return;
      }
    }
    if (!found) {
      const match = matchPlace(text, places.map((p) => p.place));
      found = (match && places.find((p) => p.place === match.place)) || undefined;
    }
    if (!found) {
      const names = [...new Set(places.map((p) => p.place.name))].slice(0, 10).join(", ");
      await say(`I heard "${text}", but I do not know that place. You can say: ${names}.${onHelp ? " Or say help to hear the tutorial." : ""}`);
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
    const t: Trip = { map, destination, destinationMap: map, target: destination, hops: [], legs: [], index: 0, facing: 0 };
    trip.current = t;
    enterRoom(t, map);
    await say(`${said} ${named("Okay {name}, going to")} ${destination.name}.`.trim());
    if (id !== run.current) return;

    await locateAndStart(id);
  }

  async function startedAtEntrance() {
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
    // first which doors, then the way inside this room to the next door or to the destination
    const hops = roomRoute(maps, { mapId: t.map.id, point: from }, { mapId: t.destinationMap.id, spotId: t.destination.id });
    if (!hops) {
      await say(`${intro} I cannot find a way from ${t.map.name} to ${t.destination.name}, the rooms are not joined by a door yet. Please ask a colleague for help.`.trim());
      goHome();
      return;
    }
    t.hops = hops;
    t.target = hops.length ? (t.map.spots.find((s) => s.id === hops[0].from.spotId) ?? t.destination) : t.destination;
    if (hops.length && !intro.includes(t.destinationMap.name)) intro = `${intro} ${t.destination.name} is in ${t.destinationMap.name}.`.trim();
    const blocked = await getBlocked(t.map.id).catch((): Blocked => ({ ids: [], reasons: {} }));
    if (id !== run.current) return;
    // temporary obstacles are planned around and announced like the ones in the map
    const temporary = blocked.obstacles ?? [];
    const room = temporary.length ? { ...t.map, spots: [...t.map.spots, ...temporary] } : t.map;
    if (temporary.length && !intro.includes("Careful")) {
      intro = `${intro} Careful, in this room today: ${temporary.map((o) => o.name.toLowerCase()).join(", ")}. I will guide you around.`.trim();
    }
    // along the walls, corner by corner; across the floor only when the walls give no way
    const walls = planAlongWalls(room, from, t.target.id, blocked.ids);
    const plan = walls.ok || walls.reason !== "no-path" ? walls : planPath(room, from, t.target.id, blocked.ids);
    if (!plan.ok) {
      if (plan.reason === "already-there") {
        if (t.hops.length) await atDoor(id);
        else await arrived(id);
        return;
      }
      const reason =
        plan.reason === "destination-blocked"
          ? `${targetName(t)} has just been reported as not available.`
          : `I cannot find a way to ${targetName(t)} around the obstacles.`;
      await say(`${intro} ${reason} Please ask a colleague for help.`.trim());
      goHome();
      return;
    }
    t.legs = plan.legs;
    t.index = 0;
    wordInstructions(t);
    await startLeg(id, intro);
  }

  // the ai words the whole route like a mobility instructor while the person already walks the first part.
  // each sentence assumes the person faces the way the part before ends
  function wordInstructions(t: Trip) {
    const tr = tracker.current;
    const legs = t.legs;
    t.phrases = undefined;
    t.templates = legs.map((leg, i) =>
      legSentence(leg, i === 0 ? (tr?.hasHeading ? tr.heading : t.facing) : legs[i - 1].heading, i === legs.length - 1, targetName(t), stepLength, legs[i - 1] ?? null, legs[i + 1] ?? null, t.map),
    );
    if (legs.length < 2) return;
    void phraseInstructions(t.templates, targetName(t))
      .then((phrases) => {
        if (trip.current === t && t.legs === legs) t.phrases = phrases;
      })
      .catch(() => {});
  }

  // step 3: one instruction at a time
  async function startLeg(id: number, intro = "") {
    const t = trip.current;
    const tr = tracker.current;
    if (!t || !tr) return;
    const leg = t.legs[t.index];
    const last = t.index === t.legs.length - 1;
    const facing = tr.hasHeading ? tr.heading : t.facing;
    const previous = t.legs[t.index - 1] ?? null;
    const next = t.legs[t.index + 1] ?? null;
    // the ai's words when they kept every fact and the person faces the way they assumed, otherwise the plain sentence
    const plain = legSentence(leg, facing, last, targetName(t), stepLength, previous, next, t.map);
    const sentence = (t.templates?.[t.index] === plain && t.phrases?.[t.index]) || plain;
    const text = [intro, sentence].filter(Boolean).join(" ");
    const checkpoint = isCheckpoint(leg, last);
    setLegInfo({ heading: Math.round(leg.heading), metres: Math.round(leg.metres * 100) / 100 });
    setCheckpointLabel(leg.end?.kind === "door" ? "Tap at the door frame" : leg.end?.kind === "wall" ? "Tap when you touch the wall" : "Tap when you reach the corner");
    setScreen(checkpoint ? "checkpoint" : "guiding");
    // without a turn the person may set off while the sentence is still being read: those steps count too
    const straightOn = tr.heading === null || Math.abs(turnAngle(tr.heading, leg.heading)) <= 25;
    const fromSteps = tr.steps;
    await say(text, true);
    if (id !== run.current) return;

    if (!tr.hasMotion) {
      await say("I cannot count your steps on this phone. Tap the screen when you have done it.");
      if (id === run.current) setScreen("manual");
      return;
    }
    if (!straightOn) {
      // the small steps of turning on the spot are not part of the walk
      await waitUntilFacing(id, leg.heading);
      if (id !== run.current) return;
    }
    follow(id, leg, straightOn ? fromSteps : tr.steps, checkpoint);
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

  // counts the steps of one part of the route. the person hears a soft tick for every step that is
  // counted, so a step the phone missed or counted twice is noticed, and the last steps are counted down
  // along a wall to a corner or a door the person tells when they feel it: the step count only helps
  function follow(id: number, leg: Leg, startSteps: number, checkpoint = false) {
    const tr = tracker.current!;
    const total = Math.max(1, Math.round(leg.metres / stepLength));
    // what the instruction already said is not repeated right after it
    const mentioned = new Set(leg.warnings.slice(0, 2).map((w) => w.spot.id));
    const announced = new Set<string>();
    let counted = 0;
    let lastStepAt = Date.now();
    let lastNudge = Date.now();
    let off = 0;
    let lastHint = 0;
    let countdown = false;
    let overdue = false;
    const watch = window.setInterval(() => {
      if (id !== run.current) return;
      const steps = Math.floor((tr.steps - startSteps) * profile.factor + 0.25);
      if (steps > counted) {
        counted = steps;
        lastStepAt = Date.now();
        beep(660, 25, 0.05);
      }
      const walkedMetres = counted * stepLength;
      const left = total - counted;
      if (left <= 0 && !checkpoint) {
        clearTimers();
        void legDone(id);
        return;
      }
      if (checkpoint && counted >= total * 1.5 + 2 && !overdue && !isSpeaking()) {
        overdue = true;
        void speak(`You should be there by now. ${leg.end?.kind === "door" ? "Feel for the door frame" : leg.end?.kind === "wall" ? "Feel for the wall" : "Feel for the corner"} and tap the top half.`);
        return;
      }
      // nothing is said over another sentence, it is said at the next check instead
      if (isSpeaking()) return;
      for (const warning of leg.warnings) {
        if (announced.has(warning.spot.id)) continue;
        const ahead = warning.atMetres - walkedMetres;
        // a reminder only when the obstacle is about to be beside the person, and not in the last step
        // a hazard or a swinging door is said again just before it, whatever was said already
        const due = warning.kind === "pass" ? ahead < 1.5 && (!mentioned.has(warning.spot.id) || warning.atMetres > 2.5) : ahead < 2;
        if (!due || (left <= 1 && warning.kind === "pass")) continue;
        announced.add(warning.spot.id);
        void speak(warningSentence(warning, stepLength, walkedMetres));
        return;
      }
      if (!countdown && total >= 5 && left === 3) {
        countdown = true;
        void speak("3 more steps.");
        return;
      }
      // standing still half way: the route is not over, say how much is left
      if (Date.now() - lastStepAt > 8000 && Date.now() - lastNudge > 12000) {
        lastNudge = Date.now();
        void speak(`Keep walking, about ${stepsText(left * stepLength, stepLength)} more.`);
        return;
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
      if (t.hops.length) await atDoor(id);
      else await arrived(id);
      return;
    }
    t.index++;
    // stopping only matters when a turn follows
    const next = t.legs[t.index];
    const facing = tracker.current?.heading ?? t.facing;
    const sharp = facing !== null && describeTurn(turnAngle(facing, next.heading)) !== null;
    // a corner or a door frame found by touch is worth a word of praise
    const praise = isCheckpoint(leg, false) ? `${named("Good, {name}.")} ` : "";
    await startLeg(id, `${praise}${sharp ? "Stop." : "Keep going."}`);
  }

  // "check where you are": the position measured since the last corner, then the way on from there
  async function checkWhere() {
    const id = newRun();
    const t = trip.current;
    const tr = tracker.current;
    if (!t || !tr) return;
    setScreen("busy");
    const position = tr.position;
    await say(`${describePosition(t.map, position, tr.heading ?? t.facing, null, stepLength)} ${whereAmI(t.map, position, t.target, tr.heading ?? t.facing, stepLength)}`);
    if (id !== run.current) return;
    await startFrom(id, position, "From here:");
  }

  // a door is a point the map knows exactly: once through it, the position starts again from there
  async function atDoor(id: number) {
    const t = trip.current;
    const next = t?.hops[0] && roomOf(t.hops[0].to.mapId);
    if (!t || !next || id !== run.current) return;
    clearTimers();
    beep(990, 150);
    const door = t.map.spots.find((s) => s.id === t.hops[0].from.spotId);
    const looks = door?.description ? ` ${door.description}` : "";
    setCheckpointLabel(door?.via === "lift" ? "Tap when you are out of the lift" : door?.via === "stairs" ? "Tap at the end of the stairs" : "Tap when you are through the door");
    if (door && changesFloor(door)) {
      // the app cannot guide in a lift or on stairs, it says what to expect and waits for the tap
      await say(`${floorChange(door, next)}${looks}`, true);
      if (id === run.current) setScreen("door");
      return;
    }
    const how = door?.opens === "in" ? " It opens towards you, pull it." : door?.opens === "out" ? " It opens away from you, push it." : door?.opens === "sliding" ? " It is a sliding door." : "";
    await say(`You are at the door to ${next.name}.${how}${looks} Go through the door and take one more step. Then tap the top half.`, true);
    if (id === run.current) setScreen("door");
  }

  async function passDoor() {
    const id = newRun();
    const t = trip.current;
    const tr = tracker.current;
    const hop = t?.hops.shift();
    const next = hop && roomOf(hop.to.mapId);
    const door = next?.spots.find((s) => s.id === hop!.to.spotId);
    if (!t || !tr || !next || !door) return;
    const through = t.map.spots.find((s) => s.id === hop!.from.spotId);
    const arrivedAt = through && changesFloor(through) ? `You are now on ${floorName(next)}, in ${next.name}, at ${door.name}.` : `You are now in ${next.name}, at ${door.name}.`;
    enterRoom(t, next);
    const { point, facing } = afterDoor(next, door);
    const start = clampInside(point, next.outline, 0.3);
    tr.setPosition(start);
    tr.anchor(facing);
    t.facing = facing;
    await startFrom(id, start, arrivedAt);
  }

  async function manualDone() {
    const id = newRun();
    await legDone(id);
  }

  async function arrived(id: number) {
    const t = trip.current;
    if (t) {
      saveLastRoom(t.destinationMap.id);
      lastArrived.current = { map: t.destinationMap, spot: t.destination };
    }
    clearTimers();
    endTrip();
    setScreen("arrived");
    beep(880, 150);
    window.setTimeout(() => beep(1320, 200), 220);
    if (id !== run.current) return;
    const on = tour.current;
    if (on) {
      const more = on.index < on.tour.stops.length - 1;
      const about = on.tour.stopTexts[on.index] ?? t?.destination.description ?? "";
      await say(
        `${named("Well done, {name}!")} You have arrived at ${t?.destination.name ?? "the stop"}. ${about} ${more ? "For the next stop, tap the bottom half of the screen." : "That was the last stop. For a short quiz, tap the bottom half of the screen."}`,
        true,
      );
      return;
    }
    const looks = t?.destination.description ? ` ${t.destination.description}` : "";
    await say(`${named("Well done, {name}!")} You have arrived at ${t?.destination.name ?? "your destination"}.${looks} To go somewhere else, tap the bottom half of the screen.`, true);
  }

  // "what is in front of me?": one photo, described by the ai. it only describes, it never says the way is clear
  async function describeAhead(id: number) {
    setScreen("busy");
    await say("Hold the phone upright at chest height, pointing ahead. Please wait.");
    if (id !== run.current) return;
    let image: string | null = null;
    try {
      if (video.current) {
        setCameraOn(true);
        stream.current = await openCamera(video.current);
        await wait(900);
        image = captureVideoFrame(video.current, 768, 0.75);
      }
    } catch {
      image = null;
    }
    stopCamera();
    if (id !== run.current) return;
    const seen = image ? await describeView(image, isWideCamera()).catch(() => null) : null;
    if (id !== run.current) return;
    beep(990, 80);
    await say(seen?.ok ? seen.say : "I cannot see anything right now. Check the camera and try again.", true);
    if (id === run.current) setScreen("home");
  }

  // the first-day tour a colleague prepared: one stop after the other, then a short spoken quiz
  async function startTour(id: number, tourId?: string) {
    const tours = await fetchTours().catch((): Tour[] => []);
    if (id !== run.current) return;
    const mine = guest ? tours.find((t) => t.guest.trim().toLowerCase() === guest.toLowerCase()) : undefined;
    let chosen = tours.find((t) => t.id === tourId) ?? mine ?? (guest ? undefined : tours[0]);
    // no tour for this person yet: the ai writes one over the places of the building
    if (!chosen) chosen = (await makeTour(id)) ?? undefined;
    if (id !== run.current) return;
    const stops = chosen?.stops.filter((ref) => roomOf(ref.mapId)?.spots.some((s) => s.id === ref.spotId)) ?? [];
    if (!chosen || stops.length === 0) {
      await say("No tour has been prepared yet. Ask a colleague to make one for you.");
      if (id === run.current) setScreen("home");
      return;
    }
    tour.current = { tour: { ...chosen, stops }, index: 0 };
    await say(chosen.welcome);
    if (id !== run.current) return;
    await goToStop(id, null);
  }

  // the places worth knowing on a first day: everything but entrances, doors, lifts and stairs, room by room
  async function makeTour(id: number): Promise<Tour | null> {
    const stops = maps
      .flatMap((map) => map.spots.filter((s, i) => i > 0 && s.kind === "place" && !s.door).map((s) => ({ mapId: map.id, spotId: s.id })))
      .slice(0, 8);
    if (stops.length === 0) return null;
    await say(named("I have no tour for you yet, {name}. I am preparing one now, this takes a few seconds."));
    if (id !== run.current) return null;
    const made = await createTour({ guest: guest || "new colleague", stops, createdBy: "AccessRoute" }).catch(() => null);
    return made?.ok ? made.tour : null;
  }

  async function goToStop(id: number, from: { map: FloorMap; spot: Spot } | null) {
    const on = tour.current;
    const ref = on?.tour.stops[on.index];
    const map = ref && roomOf(ref.mapId);
    const destination = map?.spots.find((s) => s.id === ref!.spotId);
    if (!on || !map || !destination) return;
    const t: Trip = { map, destination, destinationMap: map, target: destination, hops: [], legs: [], index: 0, facing: 0 };
    trip.current = t;
    const tr = tracker.current;
    if (from && tr) {
      // the person stands where the last stop was, so no photos are needed
      enterRoom(t, from.map);
      const start = clampInside(from.spot, from.map.outline, 0.3);
      tr.setPosition(start);
      t.facing = tr.heading ?? 0;
      await startFrom(id, start, `Stop ${on.index + 1}: ${destination.name}.`);
      return;
    }
    enterRoom(t, map);
    await say(`Stop ${on.index + 1}: ${destination.name}.`);
    if (id !== run.current) return;
    await locateAndStart(id);
  }

  async function nextStop() {
    const id = newRun();
    const on = tour.current;
    if (!on) return;
    prepareSensors();
    on.index++;
    if (on.index < on.tour.stops.length) {
      await goToStop(id, lastArrived.current);
      return;
    }
    await quiz(id, on.tour);
  }

  async function quiz(id: number, done: Tour) {
    setScreen("busy");
    tour.current = null;
    let right = 0;
    for (const q of done.quiz) {
      if (!canListen()) break;
      await say(`${q.question} Answer after the tone.`);
      if (id !== run.current) return;
      beep();
      const heard = await listenOnce();
      if (id !== run.current) return;
      const judged = heard.ok ? await judgeAnswer(q.question, q.expected, heard.text).catch(() => null) : null;
      if (id !== run.current) return;
      if (judged?.correct) right++;
      await say(judged ? judged.say : `I did not hear an answer. The answer is: ${q.expected}`);
      if (id !== run.current) return;
    }
    const score = done.quiz.length && canListen() ? ` You got ${right} of ${done.quiz.length} right.` : "";
    await say(`That is the end of the tour.${score} Welcome to the team, ${done.guest}!`);
    if (id === run.current) setScreen("home");
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
    tour.current = null;
    stopSpeaking();
    goHome();
    void say("Stopped.");
  }

  function mainTap() {
    if (screen === "start") void startedAtEntrance();
    else if (screen === "guiding") void checkWhere();
    else if (screen === "manual" || screen === "checkpoint") void manualDone();
    else if (screen === "door") void passDoor();
  }

  const huge = "flex w-full min-h-0 items-center justify-center rounded-3xl border-4 p-4 text-center font-black leading-tight";
  const half = `${huge} flex-1`;
  const topLabel = {
    start: "Tap when you are ready",
    guiding: "Tap to check where you are",
    manual: "Tap when you have done it",
    door: checkpointLabel,
    checkpoint: checkpointLabel,
  };
  const tripScreen =
    screen === "start" || screen === "guiding" || screen === "checkpoint" || screen === "manual" || screen === "door" || screen === "busy";

  // the whole screen, no scrolling: the top half and the bottom half are the only places to find
  return (
    <div
      className="fixed inset-0 z-10 flex touch-manipulation flex-col gap-3 overscroll-none bg-bg p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]"
      data-screen={screen}
      data-leg-heading={legInfo?.heading}
      data-leg-metres={legInfo?.metres}
    >
      {/* what is spoken is also given to screen readers, nothing has to be read on the screen */}
      <LiveRegion message={status} />
      {/* frames are read from this video; ios can return black frames from a video that is not on screen */}
      <video
        ref={video}
        muted
        playsInline
        aria-hidden="true"
        className={cameraOn ? "pointer-events-none absolute right-5 top-5 z-20 aspect-[3/4] w-24 rounded-xl border-2 border-bg bg-black object-cover" : "hidden"}
      />
      {testMapName && (
        <p className="pointer-events-none absolute left-5 top-5 z-20 rounded-lg bg-warn-bg px-2 py-1 text-sm font-semibold text-warn-fg">
          Test: {testMapName}
        </p>
      )}

      {screen === "home" && (
        <>
          <button type="button" onClick={() => void askDestination()} className={`${half} border-primary bg-primary text-4xl text-primary-fg`}>
            Where do you want to go?
          </button>
          <button type="button" onClick={() => void requestMap()} className={`${half} border-fg bg-bg text-3xl`}>
            Ask for a map to be recorded
          </button>
        </>
      )}

      {screen === "typing" && (
        <form
          className="flex flex-1 flex-col justify-center gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const id = newRun();
            setScreen("busy");
            void chooseDestination(typed, id);
          }}
        >
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
          <button type="submit" className={`${huge} min-h-20 border-primary bg-primary text-3xl text-primary-fg`}>
            Go
          </button>
          <button type="button" onClick={goHome} className={`${huge} min-h-20 border-fg text-2xl`}>
            Back
          </button>
        </form>
      )}

      {screen === "busy" && (
        // wrapped like the bottom half, so padding and border do not make the halves unequal
        <div className="flex min-h-0 flex-1">
          <button type="button" onClick={() => void speak("Please wait.")} className={`${half} border-border text-3xl`}>
            Please wait
          </button>
        </div>
      )}

      {(screen === "start" || screen === "guiding" || screen === "checkpoint" || screen === "manual" || screen === "door") && (
        <div className="flex min-h-0 flex-1">
          <button type="button" onClick={mainTap} className={`${half} border-primary text-3xl`}>
            {topLabel[screen]}
          </button>
        </div>
      )}

      {screen === "arrived" && (
        <>
          <div className={`${half} border-ok text-4xl`}>You have arrived</div>
          <button
            type="button"
            onClick={() => void (tour.current ? nextStop() : askDestination())}
            className={`${half} border-primary bg-primary text-3xl text-primary-fg`}
          >
            {tour.current ? (tour.current.index < tour.current.tour.stops.length - 1 ? "Next stop" : "Start the quiz") : "Go somewhere else"}
          </button>
        </>
      )}

      {tripScreen && (
        <div className="flex min-h-0 flex-1 gap-3">
          <button type="button" onClick={() => void speak(lastSpoken.current || status)} className={`${huge} flex-1 border-fg text-3xl`}>
            Repeat
          </button>
          <button type="button" onClick={stop} className={`${huge} flex-1 border-danger bg-danger text-3xl text-danger-fg`}>
            Stop
          </button>
        </div>
      )}
    </div>
  );
}
