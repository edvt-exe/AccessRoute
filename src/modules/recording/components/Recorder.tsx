"use client";

/* eslint-disable @next/next/no-img-element -- previews of photos taken on this phone */
import { useEffect, useRef, useState } from "react";
import { clampInside, outlineFromCorners, outlineFromSteps, round, wallsSoFar, type FloorMap, type Point, type Spot, type View } from "@/core/map";
import { requestMotionPermission } from "@/core/sensors/heading";
import { beep } from "@/core/speech/speech";
import { createTracker, type Tracker } from "@/core/sensors/tracker";
import { cameraErrorMessage, closeCamera, openCamera } from "@/core/storage/camera";
import { captureVideoFrame } from "@/core/storage/image";
import { Button, LiveRegion, Notice, RoomSketch, pointOnSketch } from "@/core/ui";
import { createMap, uploadVideo } from "../lib/client";
import { canRecordVideo, createVideoRecorder } from "../lib/media";
import { maxViews, newMapId, obstacleSizes, reanchor, spotPosition, thin, viewEvery, type ObstacleSize, type PendingSpot } from "../lib/walk";

type Phase = "intro" | "entrance" | "walls" | "spots" | "naming" | "saving" | "failed";

type RecorderProps = {
  staffName: string;
  onCreated: (map: FloorMap) => void;
};

const fewWallSteps = 12; // fewer steps than this around a room usually means the counter missed steps

type Naming = { kind: Spot["kind"]; photo: string; thumb: string; position: Point; heading: number | null; videoTime: number };

function boxAround(points: Point[]): Point[] {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(0, ...xs) - 1;
  const maxX = Math.max(0, ...xs) + 1;
  const minY = Math.min(0, ...ys);
  const maxY = Math.max(0, ...ys) + 1;
  return [
    { x: 0, y: 0 },
    { x: minX, y: minY },
    { x: minX, y: maxY },
    { x: maxX, y: maxY },
    { x: maxX, y: minY },
  ].map(round);
}

export function Recorder({ staffName, onCreated }: RecorderProps) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const recorder = useRef<ReturnType<typeof createVideoRecorder> | null>(null);
  const tracker = useRef<Tracker | null>(null);
  const clock = useRef({ startedAt: 0, pausedAt: 0, paused: 0 });
  const anchorIndex = useRef(0);
  const sketch = useRef<SVGSVGElement>(null);
  // automatic photos for camera recognition: wall views know their step, room views their place in the walk
  const wallViews = useRef<{ step: number; image: string }[]>([]);
  const cornerViews = useRef<{ step: number; image: string }[]>([]);
  const roomViews = useRef<(Point & { walkIndex: number; heading: number; image: string })[]>([]);
  const walkCount = useRef(0);
  const wallTotal = useRef(0);
  const mapId = useRef<string | null>(null);
  const saved = useRef<{ blob: Blob | null; videoUrl: string | null }>({ blob: null, videoUrl: null });
  const wakeLock = useRef<{ release: () => Promise<void> } | null>(null);
  const phaseRef = useRef<Phase>("intro");

  const [phase, setPhase] = useState<Phase>("intro");
  const [roomName, setRoomName] = useState("");
  const [entranceName, setEntranceName] = useState("Entrance");
  const [naming, setNaming] = useState<Naming | null>(null);
  const [spotName, setSpotName] = useState("");
  const [size, setSize] = useState<ObstacleSize>("medium");
  const [trace, setTrace] = useState<Point[]>([]);
  const [walked, setWalked] = useState<Point[]>([]);
  const [outline, setOutline] = useState<Point[]>([]);
  const [closureError, setClosureError] = useState(0);
  const [spots, setSpots] = useState<PendingSpot[]>([]);
  const [position, setPosition] = useState<Point>({ x: 0, y: 0 });
  const [stepCount, setStepCount] = useState(0);
  const [wallSteps, setWallSteps] = useState<number[]>([]); // heading of every step of the wall walk
  const [corners, setCorners] = useState<number[]>([]); // step counts at which "corner" was pressed
  const [sensors, setSensors] = useState<"unknown" | "ok" | "missing">("unknown");
  const [progress, setProgress] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  useEffect(
    () => () => {
      tracker.current?.stop();
      closeCamera(stream.current);
      void wakeLock.current?.release().catch(() => {});
    },
    [],
  );

  // the step counter needs a few seconds of walking before we know it works on this phone
  useEffect(() => {
    if (phase !== "walls") return;
    const check = window.setTimeout(() => setSensors(tracker.current?.hasMotion ? "ok" : "missing"), 4000);
    return () => window.clearTimeout(check);
  }, [phase]);

  function videoTime() {
    const c = clock.current;
    const now = performance.now();
    return Math.max(0, Math.round(((c.pausedAt || now) - c.startedAt - c.paused) / 100) / 10);
  }

  function pauseVideo() {
    recorder.current?.pause();
    clock.current.pausedAt = performance.now();
    tracker.current?.pause();
  }

  function resumeVideo() {
    const c = clock.current;
    if (c.pausedAt) c.paused += performance.now() - c.pausedAt;
    c.pausedAt = 0;
    recorder.current?.resume();
    tracker.current?.resume();
  }

  function smallView() {
    const v = video.current;
    return v ? captureVideoFrame(v, 256, 0.6) : null;
  }

  function photo() {
    const v = video.current;
    return { photo: (v && captureVideoFrame(v, 768, 0.75)) ?? "", thumb: (v && captureVideoFrame(v, 384, 0.7)) ?? "" };
  }

  async function openCam() {
    setError("");
    if (!canRecordVideo()) {
      setError("This browser cannot record video. Use Chrome on Android or Safari on iPhone.");
      return;
    }
    const keepAwake = (navigator as unknown as { wakeLock?: { request: (t: string) => Promise<{ release: () => Promise<void> }> } }).wakeLock;
    keepAwake?.request("screen").then((lock) => (wakeLock.current = lock)).catch(() => {});
    // asked first, still inside the tap, ios refuses the prompt otherwise
    const motion = requestMotionPermission();
    try {
      if (video.current) stream.current = await openCamera(video.current);
    } catch (e) {
      setError(cameraErrorMessage(e));
      return;
    }
    if (!(await motion)) setError("Motion access was refused. Steps and turns cannot be measured without it.");
    tracker.current = createTracker();
    tracker.current.onStep((step) => {
      setStepCount(step.index);
      setPosition(step.position);
      if (phaseRef.current === "walls") {
        setWallSteps((w) => [...w, step.heading]);
        setTrace((t) => [...t, round(step.position)]);
        if (step.index % viewEvery.walls === 0) {
          const image = smallView();
          if (image) wallViews.current.push({ step: step.index, image });
        }
      } else if (phaseRef.current === "spots") {
        setWalked((w) => [...w, round(step.position)]);
        const walkIndex = walkCount.current++;
        if (walkIndex % viewEvery.spots === 0) {
          const image = smallView();
          if (image) roomViews.current.push({ ...round(step.position), walkIndex, heading: step.heading, image });
        }
      }
    });
    setPhase("entrance");
    setMessage("Camera is on. Stand in the entrance, facing into the room.");
  }

  function startWalls() {
    const shot = photo();
    if (!shot.photo || !stream.current || !tracker.current) {
      setError("The camera is not ready yet, try again in a second.");
      return;
    }
    // from here on, "straight ahead" means into the room
    tracker.current.anchor(0);
    tracker.current.setPosition({ x: 0, y: 0 });
    tracker.current.resetSteps();
    setStepCount(0);
    const entrance: PendingSpot = {
      id: "s1",
      kind: "place",
      name: entranceName.trim() || "Entrance",
      x: 0,
      y: 0,
      radius: 0,
      heading: 0,
      ...shot,
      videoTime: 0,
      walkIndex: 0,
    };
    setSpots([entrance]);
    setTrace([{ x: 0, y: 0 }]);
    setWallSteps([]);
    setCorners([]);
    wallViews.current = [];
    cornerViews.current = [];
    roomViews.current = [];
    recorder.current = createVideoRecorder(stream.current);
    recorder.current.start();
    clock.current = { startedAt: performance.now(), pausedAt: 0, paused: 0 };
    setError("");
    setPhase("walls");
    setMessage("Recording. Walk along the walls. In every corner face into the room and press Corner.");
  }

  function markCorner() {
    if (corners.at(-1) === wallSteps.length || wallSteps.length === 0) return;
    setCorners([...corners, wallSteps.length]);
    // the recorder faces into the room here, a clear view of most of it
    const v = video.current;
    const image = v && captureVideoFrame(v, 384, 0.6);
    if (image) cornerViews.current.push({ step: wallSteps.length, image });
    beep(1100, 120);
    setMessage(`Corner ${corners.length + 1} saved with a photo. Carry on along the next wall.`);
  }

  function finishWalls() {
    // with marked corners each wall is exactly what was walked between two presses, otherwise corners are guessed
    const { outline: computed, closureError: gap } =
      corners.length >= 2 ? outlineFromCorners(wallSteps, corners, 0.7) : outlineFromSteps(wallSteps, 0.7);
    // a walk with too few corners cannot make a room, a box around the walk keeps the recording usable
    const room = computed.length >= 3 ? computed : boxAround(trace);
    setOutline(room);
    setClosureError(gap);
    wallTotal.current = wallSteps.length;
    // the gyroscope drifts a little during the wall walk; facing into the room again resets "straight ahead"
    tracker.current?.anchor(0);
    // from now on a step can never end up behind a wall
    tracker.current?.constrain((p) => clampInside(p, room, 0.3));
    tracker.current?.setPosition({ x: 0, y: 0 });
    setPosition({ x: 0, y: 0 });
    setWalked([{ x: 0, y: 0 }]);
    walkCount.current = 1;
    anchorIndex.current = 0;
    setPhase("spots");
    setMessage("Walls saved. Now walk to every place and obstacle and add it.");
  }

  function startSpot(kind: Spot["kind"]) {
    const shot = photo();
    if (!shot.photo || !tracker.current) {
      setError("The camera picture is not ready, wait a second and try again.");
      return;
    }
    setNaming({ kind, ...shot, position: tracker.current.position, heading: tracker.current.heading, videoTime: videoTime() });
    pauseVideo();
    setSpotName("");
    setSize("medium");
    setError("");
    setPhase("naming");
    setMessage(kind === "place" ? "Paused. Type the name of this place." : "Paused. Type what the obstacle is.");
  }

  function saveSpot() {
    const name = spotName.trim();
    if (!naming || !name) return;
    const radius = naming.kind === "obstacle" ? obstacleSizes[size].radius : 0;
    const spot: PendingSpot = {
      id: `s${spots.length + 1}`,
      kind: naming.kind,
      name,
      // places can sit against a wall, an obstacle's middle is at least half its size away from it
      ...round(clampInside(spotPosition(naming.position, naming.heading, naming.kind, radius), outline, naming.kind === "obstacle" ? Math.max(0.2, radius * 0.6) : 0.15)),
      radius,
      heading: naming.heading,
      photo: naming.photo,
      thumb: naming.thumb,
      videoTime: naming.videoTime,
      walkIndex: walked.length - 1,
    };
    setSpots([...spots, spot]);
    setNaming(null);
    resumeVideo();
    setPhase("spots");
    setMessage(`${name} saved. Recording again.`);
  }

  function cancelSpot() {
    setNaming(null);
    resumeVideo();
    setPhase("spots");
  }

  // the person sees the room and knows where they stand better than the step counter does
  function moveHere(event: { clientX: number; clientY: number }) {
    const point = pointOnSketch(sketch.current, event);
    if (!point || outline.length < 3) return;
    const inside = round(clampInside(point, outline, 0.3));
    tracker.current?.setPosition(inside);
    setPosition(inside);
    // a known position, like the entrance: later corrections do not move what was placed before it
    setWalked([...walked, inside]);
    anchorIndex.current = walked.length;
    walkCount.current = walked.length + 1;
    setMessage("Position corrected.");
  }

  function backAtEntrance() {
    const result = reanchor(walked, anchorIndex.current, spots);
    roomViews.current = reanchor(walked, anchorIndex.current, roomViews.current).spots;
    setWalked(result.walked);
    setSpots(result.spots);
    anchorIndex.current = result.walked.length - 1;
    tracker.current?.anchor(0);
    tracker.current?.setPosition({ x: 0, y: 0 });
    setPosition({ x: 0, y: 0 });
    setMessage(`Position reset at the entrance. The walk was off by ${result.error.toFixed(1)} m and has been corrected.`);
  }

  function collectViews(): View[] {
    const total = Math.max(1, wallTotal.current);
    const along = (step: number) => Math.round((Math.min(step, total) / total) * 1000) / 1000;
    const walls = thin(wallViews.current.filter((v) => v.step <= total), maxViews.walls).map((v) => ({
      along: along(v.step),
      x: 0,
      y: 0,
      heading: 0,
      image: v.image,
      intoRoom: false,
    }));
    const cornerShots = thin(cornerViews.current, maxViews.corners).map((v) => ({
      along: along(v.step),
      x: 0,
      y: 0,
      heading: 0,
      image: v.image,
      intoRoom: true,
    }));
    const room = thin(roomViews.current, maxViews.spots).map((v) => ({
      along: null,
      ...round(clampInside(v, outline, 0.2)),
      heading: Math.round(v.heading) % 360,
      image: v.image,
      intoRoom: false,
    }));
    return [...cornerShots, ...walls, ...room].map((v, i) => ({ id: `v${i + 1}`, ...v }));
  }

  async function finish() {
    if (!recorder.current) return;
    setPhase("saving");
    setError("");
    mapId.current ??= newMapId(roomName || "room");
    const id = mapId.current;
    const done = saved.current;
    try {
      if (!done.blob) {
        setProgress("Finishing the video…");
        done.blob = await recorder.current.stop(videoTime() * 1000);
        tracker.current?.stop();
        closeCamera(stream.current);
        void wakeLock.current?.release().catch(() => {});
      }
      if (!done.videoUrl) {
        try {
          done.videoUrl = await uploadVideo(id, done.blob, (p) => setProgress(`Uploading the video… ${p}%`));
        } catch {
          setError("The video could not be uploaded. The map is saved without it.");
        }
      }
      setProgress("Saving the map…");
      const now = new Date().toISOString();
      const map: FloorMap = {
        id,
        name: roomName.trim() || "Untitled room",
        status: "review",
        createdBy: staffName,
        createdAt: now,
        updatedAt: now,
        videoUrl: done.videoUrl,
        outline,
        spots: spots.map(({ walkIndex, ...spot }) => {
          void walkIndex;
          return spot;
        }),
        walked: walked.slice(-3000),
        closureError,
        version: 0,
      };
      onCreated(await createMap(map, collectViews()));
    } catch (e) {
      setError(`Saving failed: ${(e as Error).message}. Your recording is kept on this phone, try again.`);
      setPhase("failed");
    }
  }

  const live = phase === "walls" || phase === "spots" || phase === "naming";
  // drawn with the same straightening as the final outline, so what you see is what you get
  const preview = phase === "walls" && corners.length > 0 ? wallsSoFar(wallSteps, corners, 0.7) : [];
  const places = spots.filter((s) => s.kind === "place").length;
  const obstacles = spots.filter((s) => s.kind === "obstacle").length;

  return (
    <div className="flex flex-col gap-4">
      <LiveRegion message={message} />

      <div className={phase === "intro" || phase === "saving" || phase === "failed" ? "hidden" : "relative mx-auto w-fit"}>
        <video
          ref={video}
          muted
          playsInline
          aria-hidden="true"
          className={`mx-auto aspect-[3/4] rounded-xl bg-black object-cover ${phase === "entrance" ? "h-[55dvh]" : phase === "naming" ? "h-[20dvh]" : "h-[34dvh]"}`}
        />
        {live && (
          <p className="absolute left-3 top-3 rounded-lg bg-black/80 px-3 py-2 text-xl font-bold text-white">
            <span className={phase === "naming" ? "text-yellow-300" : "text-red-400"}>{phase === "naming" ? "❚❚ PAUSED" : "● REC"}</span>{" "}
            <span aria-live="off">{stepCount} steps</span>
          </p>
        )}
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {sensors === "missing" && phase === "walls" && (
        <Notice tone="warn">No steps detected yet. Hold the phone upright and walk normally. On a laptop steps cannot be measured, use a phone.</Notice>
      )}

      {phase === "intro" && (
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void openCam();
          }}
        >
          <Notice>
            <strong>1.</strong> Walk once along all the walls of the room and come back to the entrance.
            <br />
            <strong>2.</strong> From the entrance, walk to every place and obstacle (pillar, sofa, plant) and add it.
            <br />
            Hold the phone upright at chest height, pointing where you walk. Film the room, not your colleagues.
          </Notice>
          <label htmlFor="room-name" className="text-lg font-semibold">
            Room name
          </label>
          <input
            id="room-name"
            required
            value={roomName}
            maxLength={80}
            onChange={(e) => setRoomName(e.target.value)}
            placeholder="e.g. Open office, 2nd floor"
            className="min-h-14 rounded-xl border-2 border-fg bg-bg px-3 text-lg"
          />
          <Button type="submit" className="min-h-16 text-xl">
            Open camera
          </Button>
        </form>
      )}

      {phase === "entrance" && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            startWalls();
          }}
        >
          <p className="text-lg">Stand in the entrance, facing into the room. Guided colleagues will start from here too.</p>
          <label htmlFor="entrance-name" className="text-lg font-semibold">
            Name of the entrance
          </label>
          <input
            id="entrance-name"
            required
            value={entranceName}
            maxLength={60}
            onChange={(e) => setEntranceName(e.target.value)}
            className="min-h-14 rounded-xl border-2 border-fg bg-bg px-3 text-lg"
          />
          <Button type="submit" variant="danger" className="min-h-16 text-xl">
            ● Start: walk along the walls
          </Button>
        </form>
      )}

      {phase === "walls" && (
        <div className="flex flex-col gap-3">
          <p className="text-lg">
            Hold the phone upright and steady, do not tilt it up and down. Walk along the walls, keeping them close on one side. In <strong>every corner</strong> of the room, stand in
            the corner, <strong>turn to face into the room</strong> and press <strong>Corner</strong> (it takes a photo), then carry on along the next wall. When you are back at the entrance, face into the room exactly
            like at the start and press the last button.
          </p>
          <Button onClick={markCorner} disabled={wallSteps.length === 0 || corners.at(-1) === wallSteps.length} className="min-h-24 flex-col text-3xl">
            Corner
            <span className="block text-lg font-normal">{corners.length} marked</span>
          </Button>
          <Button variant="secondary" onClick={finishWalls} disabled={trace.length < 2} className="min-h-16 text-xl">
            I am back at the entrance
          </Button>
          {trace.length - 1 < fewWallSteps && trace.length > 1 && (
            <p className="text-muted">Only {trace.length - 1} steps counted so far. If you walked more, hold the phone upright and walk at a normal pace.</p>
          )}
          {corners.length === 0 ? (
            <RoomSketch outline={[]} spots={[]} trace={trace} position={position} label={`Wall walk so far, ${wallSteps.length} steps`} />
          ) : (
            <RoomSketch
              outline={[]}
              spots={[]}
              route={preview}
              position={preview.at(-1)}
              label={`Walls so far: ${corners.length} corners, ${wallSteps.length} steps`}
            />
          )}
        </div>
      )}

      {phase === "spots" && (
        <div className="flex flex-col gap-3">
          <p className="text-lg">
            Walk to a place or obstacle, stand right in front of it facing it, then press a button. Whenever you pass the
            entrance, face into the room and press “I am back at the entrance” to keep the map accurate.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Button onClick={() => startSpot("place")} className="min-h-24 text-xl">
              + Add location
            </Button>
            <Button variant="danger" onClick={() => startSpot("obstacle")} className="min-h-24 text-xl">
              + Add obstacle
            </Button>
          </div>
          <div onPointerDown={(event) => moveHere(event)}>
            <RoomSketch
              svgRef={sketch}
              outline={outline}
              spots={spots}
              trace={walked}
              position={position}
              label={`Room with ${places} places and ${obstacles} obstacles. Tap where you are standing to correct your position.`}
            />
            <p className="mt-1 text-muted">Yellow dot in the wrong place? Tap the map where you are standing.</p>
          </div>
          <Button variant="secondary" onClick={backAtEntrance}>
            I am back at the entrance (improves accuracy)
          </Button>
          <Button variant="secondary" onClick={() => void finish()} disabled={spots.length < 2}>
            Finish recording
          </Button>
        </div>
      )}

      {phase === "naming" && naming && (
        <form
          className="flex flex-col gap-3 rounded-xl border-2 border-primary p-4"
          onSubmit={(event) => {
            event.preventDefault();
            saveSpot();
          }}
        >
          <img src={naming.photo} alt="Photo of this spot" className="max-h-40 rounded-lg object-cover" />
          <label htmlFor="spot-name" className="text-lg font-semibold">
            {naming.kind === "place" ? "Name of this place" : "What is the obstacle?"}
          </label>
          <input
            id="spot-name"
            autoFocus
            required
            value={spotName}
            maxLength={60}
            onChange={(e) => setSpotName(e.target.value)}
            placeholder={naming.kind === "place" ? "e.g. Lift 1" : "e.g. Plant"}
            className="min-h-14 rounded-xl border-2 border-fg bg-bg px-3 text-lg"
          />
          {naming.kind === "obstacle" && (
            <fieldset className="flex flex-col gap-2">
              <legend className="mb-1 text-lg font-semibold">How big is it?</legend>
              {(Object.keys(obstacleSizes) as ObstacleSize[]).map((key) => (
                <label key={key} className="flex min-h-12 items-center gap-3 rounded-lg border-2 border-border px-3 text-lg">
                  <input type="radio" name="size" checked={size === key} onChange={() => setSize(key)} className="h-6 w-6" />
                  {obstacleSizes[key].label}
                </label>
              ))}
            </fieldset>
          )}
          <div className="grid grid-cols-2 gap-3">
            <Button variant="secondary" onClick={cancelSpot}>
              Cancel
            </Button>
            <Button type="submit" disabled={!spotName.trim()}>
              Save
            </Button>
          </div>
        </form>
      )}

      {phase === "failed" && (
        <Button onClick={() => void finish()} className="min-h-16 text-xl">
          Try saving again
        </Button>
      )}

      {phase === "saving" && (
        <div className="flex flex-col gap-3" role="status" aria-live="polite">
          <p className="text-xl font-semibold">{progress}</p>
          <p className="text-muted">Keep this page open.</p>
        </div>
      )}
    </div>
  );
}
