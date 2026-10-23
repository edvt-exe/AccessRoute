"use client";

import { advance, defaultStepLength, normalizeHeading, snapHeading, type Point } from "@/core/map";
import { watchHeading } from "./heading";
import { StepCounter, sampleFrom, watchMotion } from "./steps";

export type StepEvent = { index: number; heading: number; position: Point };

// pedestrian dead reckoning: every detected step moves the position one step length
// in the direction the phone points, in the room frame (0 = facing into the room from the entrance)
export function createTracker({ stepLength = defaultStepLength, snap = true } = {}) {
  let raw: number | null = null;
  let offset = 0;
  let position: Point = { x: 0, y: 0 };
  let steps = 0;
  let motion = false;
  let paused = false;
  // set when anchoring before the first gyroscope reading arrived
  let pendingFacing: number | null = null;
  let constraint: ((point: Point) => Point) | null = null;
  const listeners = new Set<(event: StepEvent) => void>();

  const heading = () => (raw === null ? null : normalizeHeading(raw - offset));

  const stopHeading = watchHeading((value) => {
    raw = value;
    if (pendingFacing !== null) {
      offset = normalizeHeading(value - pendingFacing);
      pendingFacing = null;
    }
  });
  function step() {
    const h = heading() ?? 0;
    position = advance(position, snap ? snapHeading(h) : h, stepLength);
    if (constraint) position = constraint(position);
    steps++;
    listeners.forEach((listener) => listener({ index: steps, heading: h, position }));
  }

  const counter = new StepCounter();
  const stopMotion = watchMotion((reading) => {
    motion = true;
    // typing a name or listening to an instruction makes the phone shake, those are not steps
    if (paused) return;
    for (let i = counter.push(sampleFrom(reading)); i > 0; i--) step();
  });

  return {
    // tells the tracker which way the person faces right now, in the room frame
    anchor(facing = 0) {
      if (raw !== null) offset = normalizeHeading(raw - facing);
      else pendingFacing = facing;
    },
    // for example: keep the position inside the walls of the room
    constrain(fn: ((point: Point) => Point) | null) {
      constraint = fn;
    },
    // the counter restarts when the real walk starts, steps taken while getting ready do not count
    resetSteps() {
      steps = 0;
    },
    // while paused the person is not expected to walk, bounces half seen before are forgotten
    pause() {
      paused = true;
      counter.reset();
    },
    // the person is expected to stand: a walk has to show a steady rhythm before its steps count
    resume() {
      paused = false;
      counter.reset();
    },
    // the person was asked to walk, so steps count without waiting for a rhythm. oneWalk: only until they stop
    expectWalk({ oneWalk = false } = {}) {
      paused = false;
      counter.expectWalk({ oneWalk });
    },
    // the person says they arrived somewhere: steps held back while no rhythm showed are counted now
    takePending() {
      if (paused) return;
      for (let i = counter.takePending(performance.now()); i > 0; i--) step();
    },
    setPosition(point: Point) {
      position = point;
    },
    get position() {
      return position;
    },
    get heading() {
      return heading();
    },
    get steps() {
      return steps;
    },
    get hasMotion() {
      return motion;
    },
    get hasHeading() {
      return raw !== null;
    },
    onStep(listener: (event: StepEvent) => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    stop() {
      stopHeading();
      stopMotion();
      listeners.clear();
    },
  };
}

export type Tracker = ReturnType<typeof createTracker>;
