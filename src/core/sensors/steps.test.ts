import { describe, expect, it } from "vitest";
import { StepDetector, StepTrain } from "./steps";

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

// a step as a phone in the hand feels it: heel strike, bounce back, then the push-off of the foot
function realistic(cadence: number, pushOff: number, seconds = 10, detector = new StepDetector(), start = 0) {
  let count = 0;
  let seed = 5;
  const random = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;
  const period = 1000 / cadence;
  const bump = (x: number, width: number) => Math.exp(-((x / width) ** 2));
  for (let t = 0; t < seconds * 1000; t += 1000 / 60) {
    const k = t % period;
    const value = 9.81 + 2 * (bump(k - 80, 60) - 0.5 * bump(k - 220, 80) + pushOff * bump(k - 80 - 0.42 * period, 70)) + 0.2 * random();
    if (detector.push(value, start + t)) count++;
  }
  return count;
}

describe("StepDetector on a real step shape", () => {
  it.each([0.9, 1.1, 1.3, 1.6, 2])("does not count the push-off as a step at %s steps a second", (cadence) => {
    const count = realistic(cadence, 0.9);
    expect(count).toBeGreaterThanOrEqual(cadence * 10 - 1);
    expect(count).toBeLessThanOrEqual(cadence * 10 + 2);
  });

  it("keeps the rhythm after a stop, so the next stretch counts right from the first step", () => {
    const detector = new StepDetector();
    realistic(1.1, 0.9, 6, detector);
    // a pause of 4 seconds, then 5 more seconds of walking
    for (let t = 6000; t < 10000; t += 1000 / 60) detector.push(9.81, t);
    expect(realistic(1.1, 0.9, 5, detector, 10000)).toBeLessThanOrEqual(6);
  });
});

describe("StepTrain", () => {
  it("counts a walk, including its first step", () => {
    const train = new StepTrain();
    const counted = [0, 550, 1100, 1650, 2200].map((t) => train.step(t));
    expect(counted.reduce((a, b) => a + b)).toBe(5);
    expect(counted[0]).toBe(0); // held back until the second step proves it is a walk
  });

  it("drops single bumps of a phone held while standing", () => {
    const train = new StepTrain();
    expect([0, 3000, 7000, 9500].map((t) => train.step(t)).reduce((a, b) => a + b)).toBe(0);
  });

  it("drops bounces while the phone is tilted up or down", () => {
    const train = new StepTrain();
    let total = 0;
    for (let t = 0; t < 2000; t += 400) {
      train.tilting(t);
      total += train.step(t + 100);
    }
    expect(total).toBe(0);
  });
});
