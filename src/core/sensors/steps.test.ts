import { describe, expect, it } from "vitest";
import { StepCounter, StepDetector, type MotionSample } from "./steps";

// a walking signal: main bounce, a heel-strike harmonic and sensor noise, sampled at 60 Hz
function simulate({ cadence = 1.8, seconds = 10, amplitude = 2, harmonic = 0.35, noise = 0.15 } = {}) {
  const detector = new StepDetector();
  let count = 0;
  let seed = 7;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  for (let t = 0; t < seconds * 1000; t += 1000 / 60) {
    const phase = (2 * Math.PI * cadence * t) / 1000;
    const value = 9.81 + amplitude * (Math.sin(phase) + harmonic * Math.sin(2 * phase + 1)) + noise * random();
    if (detector.push(value, t)) count++;
  }
  return count;
}

describe("StepDetector", () => {
  it.each([
    ["a normal walk", { cadence: 1.8, amplitude: 2 }, 18],
    ["a brisk walk with a bouncy phone", { cadence: 2.1, amplitude: 4 }, 21],
    ["a gentle walk, phone held steady in the hand", { cadence: 1.6, amplitude: 0.7 }, 16],
    ["a slow careful walk", { cadence: 1, amplitude: 1.2 }, 10],
  ])("counts %s", (_, options, expected) => {
    const count = simulate(options);
    expect(count).toBeGreaterThanOrEqual(expected - 2);
    expect(count).toBeLessThanOrEqual(expected + 1);
  });

  it("does not count a phone held still in a shaky hand", () => {
    expect(simulate({ amplitude: 0, noise: 0.3 })).toBe(0);
  });

  it("does not count the heel strike as a second step", () => {
    expect(simulate({ cadence: 1.5, amplitude: 2, harmonic: 0.8 })).toBeLessThanOrEqual(16);
  });
});

// one bounce per given time, like a step or a jolt of the hand, sampled at 60 Hz
function pulses(times: number[], { amplitude = 2.5, rotation = 0, until = (times.at(-1) ?? 0) + 1000 } = {}) {
  const samples: MotionSample[] = [];
  for (let t = 0; t <= until; t += 1000 / 60) {
    const bounce = times.reduce((sum, start) => (t >= start && t < start + 250 ? sum + Math.sin(((t - start) / 250) * Math.PI) : sum), 0);
    samples.push({ t, magnitude: 9.81 + amplitude * bounce, rotation });
  }
  return samples;
}

function count(samples: MotionSample[], counter = new StepCounter()) {
  return samples.reduce((total, sample) => total + counter.push(sample), 0);
}

const every = (gap: number, n: number, from = 500) => Array.from({ length: n }, (_, i) => from + i * gap);

describe("StepCounter", () => {
  it("counts a steady walk, including the steps held back until the rhythm was clear", () => {
    expect(count(pulses(every(550, 12)))).toBe(12);
  });

  it("counts a slow careful walk", () => {
    expect(count(pulses(every(1200, 8)))).toBe(8);
  });

  it("does not count one or two bumps of a phone held while standing", () => {
    expect(count(pulses([500]))).toBe(0);
    expect(count(pulses([500, 1100]))).toBe(0);
  });

  it("does not count irregular jolts of the hand", () => {
    expect(count(pulses([500, 1400, 1800, 3100, 3500, 5200, 5700, 6900]))).toBe(0);
  });

  it("does not count bumps that are too far apart to be a walk", () => {
    expect(count(pulses(every(2500, 6)))).toBe(0);
  });

  it("does not count stepping while turning on the spot", () => {
    expect(count(pulses(every(600, 8), { rotation: 150 }))).toBe(0);
  });

  it("keeps counting a walk that turns a corner", () => {
    const walk = pulses(every(550, 12));
    const cornered = walk.map((s) => (s.t > 3000 && s.t < 4500 ? { ...s, rotation: 150 } : s));
    expect(count(cornered)).toBe(12);
  });

  it("ends the walk when the person stops, a later bump is not a step", () => {
    expect(count(pulses([...every(550, 6), 6500]))).toBe(6);
  });

  it("counts a short walk of two steps when the person was asked to walk", () => {
    const counter = new StepCounter();
    counter.expectWalk();
    expect(count(pulses([500, 1100]), counter)).toBe(2);
  });

  it("holds back a lone bump while walking is expected, until the person says they arrived", () => {
    const counter = new StepCounter();
    counter.expectWalk();
    expect(count(pulses([500]), counter)).toBe(0);
    expect(counter.takePending(1600)).toBe(1);
  });

  it("needs a rhythm again once the one expected walk has stopped", () => {
    const counter = new StepCounter();
    counter.expectWalk({ oneWalk: true });
    expect(count(pulses([...every(550, 3), 4500, 5100]), counter)).toBe(3);
  });

  it("keeps counting after a pause when walking is expected for the whole leg", () => {
    const counter = new StepCounter();
    counter.expectWalk();
    expect(count(pulses([...every(550, 3), 4500, 5100]), counter)).toBe(5);
  });

  it("counts a short walk held back while standing, once the person says they arrived", () => {
    const counter = new StepCounter();
    expect(count(pulses([500, 1100, 1650]), counter)).toBe(0);
    expect(counter.takePending(3000)).toBe(3);
  });

  it("does not count held back bumps that are long past", () => {
    const counter = new StepCounter();
    count(pulses([500, 1100]), counter);
    expect(counter.takePending(9000)).toBe(0);
  });

  it("forgets bumps seen before a reset", () => {
    const counter = new StepCounter();
    const samples = pulses([500, 1050, 1600]);
    const beforeThird = samples.filter((s) => s.t < 1500);
    count(beforeThird, counter);
    counter.reset();
    expect(count(samples.filter((s) => s.t >= 1500), counter)).toBe(0);
  });
});
