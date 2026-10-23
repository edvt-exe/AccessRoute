// one reading of the motion sensors as the browser gives it: time in ms, acceleration including gravity
// in m/s² and rotation rate in degrees per second. kept as a tuple so recorded traces stay small
export type RawMotion = [t: number, ax: number, ay: number, az: number, alpha: number, beta: number, gamma: number];

// what the step counter looks at: how hard the phone is pushed and how fast it turns, whatever way it is held
export type MotionSample = { t: number; magnitude: number; rotation: number };

export function sampleFrom([t, ax, ay, az, alpha, beta, gamma]: RawMotion): MotionSample {
  return { t, magnitude: Math.hypot(ax, ay, az), rotation: Math.hypot(alpha, beta, gamma) };
}

// every value here was tuned on sensor traces recorded on real phones, see traces.test.ts
export const stepTuning = {
  // walking puts its energy at the step rate, 0.7 to 2 steps per second. a hand holding the phone still,
  // or typing on it, shakes faster than that, so only this band of the signal is looked at
  highPass: 0.3, // Hz
  lowPass: 2, // Hz
  threshold: 0.3, // m/s², how high a bounce in that band must be
  minGap: 300, // ms, faster than any walk
  maxGap: 1400, // ms, a careful step every 1.4 s is the slowest walk that is counted
  regularity: 1.6, // the longest gap of a starting walk may be at most this times the shortest
  confirm: 4, // bounces in a steady rhythm before a walk is believed
  turning: 40, // degrees per second, averaged: faster than this the hand moves the phone, or the person turns on the spot
  turnWindow: 300, // ms over which the rotation is averaged
  pendingFor: 6000, // ms: bounces held back this recently still count when the person says they arrived
};

// a second order butterworth filter. its coefficients follow the sample rate, which differs between phones
class Biquad {
  private x1 = 0;
  private x2 = 0;
  private y1 = 0;
  private y2 = 0;
  private b = [0, 0, 0];
  private a = [0, 0];
  private rate = 0;

  constructor(
    private kind: "low" | "high",
    private cutoff: number,
  ) {}

  run(x: number, rate: number) {
    if (Math.abs(rate - this.rate) > this.rate * 0.05) this.design(rate);
    const y = this.b[0] * x + this.b[1] * this.x1 + this.b[2] * this.x2 - this.a[0] * this.y1 - this.a[1] * this.y2;
    this.x2 = this.x1;
    this.x1 = x;
    this.y2 = this.y1;
    this.y1 = y;
    return y;
  }

  private design(rate: number) {
    this.rate = rate;
    const w = (2 * Math.PI * this.cutoff) / rate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
    const a0 = 1 + alpha;
    const edge = this.kind === "low" ? (1 - cos) / 2 : (1 + cos) / 2;
    this.b = [edge / a0, ((this.kind === "low" ? 1 : -1) * 2 * edge) / a0, edge / a0];
    this.a = [(-2 * cos) / a0, (1 - alpha) / a0];
  }
}

// finds the bounces of a phone held in front of the body, at the pace of walking. every bounce it finds
// is only a candidate: a hand can move the phone the same way, StepCounter decides what is a step
export class StepDetector {
  private highPass = new Biquad("high", stepTuning.highPass);
  private lowPass = new Biquad("low", stepTuning.lowPass);
  private offset: number | null = null;
  private lastTime: number | null = null;
  private interval = 1000 / 60;
  private measured = false;
  private previous = 0;
  private rising = false;
  private armed = true;
  private lastBounce = -Infinity;

  push(magnitude: number, timeMs: number) {
    this.trackRate(timeMs);
    // starting from the first reading keeps the filters from ringing on the jump from zero to gravity
    this.offset ??= magnitude;
    const rate = 1000 / this.interval;
    const y = this.lowPass.run(this.highPass.run(magnitude - this.offset, rate), rate);

    // the top of a bounce: the filtered signal stops rising above the threshold. one bounce per swing above zero
    const peak = this.rising && y < this.previous && this.previous > stepTuning.threshold;
    const found = peak && this.armed && timeMs - this.lastBounce >= stepTuning.minGap;
    if (found) {
      this.armed = false;
      this.lastBounce = timeMs;
    }
    if (y < 0) this.armed = true;
    this.rising = y > this.previous;
    this.previous = y;
    return found;
  }

  private trackRate(timeMs: number) {
    const gap = this.lastTime === null ? null : timeMs - this.lastTime;
    this.lastTime = timeMs;
    // a pause in the readings (the tab was hidden) says nothing about the sample rate
    if (gap === null || gap <= 0 || gap > 200) return;
    this.interval = this.measured ? this.interval * 0.95 + gap * 0.05 : gap;
    this.measured = true;
  }
}

function median(values: number[]) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function isSteady(gaps: number[]) {
  return gaps.length > 0 && Math.max(...gaps) <= Math.min(...gaps) * stepTuning.regularity;
}

// a real walk is a train of bounces with a steady rhythm. a phone held while standing also bounces (typing,
// looking at the screen, shifting weight, turning on the spot) but rarely for long in a steady rhythm.
// standing, bounces are held back until the rhythm is clear, then all of them are counted at once.
// when the app knows the person walks (it just asked them to), a short walk of one to three steps would
// never show that rhythm, so bounces count right away instead, see expectWalk
export class StepCounter {
  private detector = new StepDetector();
  private pending: number[] = []; // bounces held back: the start of a walk, or a lone bump
  private gaps: number[] = []; // the last gaps of the walk in progress
  private last = -Infinity; // the last counted step
  private walking = false; // in a steady rhythm
  private expecting = false; // the app asked the person to walk
  private oneWalk = false; // expecting ends when that walk stops
  private run = 0; // bounces in the current walk while expecting
  private rotation = 0; // averaged
  private lastSample: number | null = null;

  get isWalking() {
    return this.walking;
  }

  // the person stands still from here on, bounces seen so far are forgotten
  reset() {
    this.pending = [];
    this.gaps = [];
    this.last = -Infinity;
    this.walking = false;
    this.expecting = false;
    this.oneWalk = false;
    this.run = 0;
  }

  // the person was asked to walk: from the second bounce on, every bounce counts at once (the first is held
  // until the second shows it was not a lone bump). oneWalk: once that walk stops, a rhythm is needed again,
  // otherwise this lasts until reset
  expectWalk({ oneWalk = false } = {}) {
    this.reset();
    this.expecting = true;
    this.oneWalk = oneWalk;
  }

  // the person says they arrived somewhere (a corner, a spot): bounces held back were a short walk after all.
  // returns how many steps to count now
  takePending(timeMs: number) {
    const latest = this.pending.at(-1);
    const count = latest !== undefined && timeMs - latest <= stepTuning.pendingFor ? this.pending.length : 0;
    this.pending = [];
    if (count > 0) this.last = timeMs;
    return count;
  }

  // returns how many steps to count now
  push(sample: MotionSample): number {
    const elapsed = this.lastSample === null ? 0 : Math.max(0, sample.t - this.lastSample);
    this.lastSample = sample.t;
    this.rotation += (sample.rotation - this.rotation) * Math.min(1, elapsed / stepTuning.turnWindow);
    if (!this.detector.push(sample.magnitude, sample.t)) return 0;
    return this.bounce(sample.t);
  }

  private bounce(t: number): number {
    if (this.walking) return this.continueWalk(t);
    // turning a walking body round a corner is fine, see continueWalk. standing, it is the hand or the feet turning on the spot
    if (this.rotation > stepTuning.turning) return 0;
    return this.expecting ? this.expectedStep(t) : this.startWalk(t);
  }

  private continueWalk(t: number) {
    const gap = t - this.last;
    const typical = median(this.gaps);
    // a second bounce inside one step: heel and toe, or the hand moving the phone
    if (gap < Math.max(stepTuning.minGap, typical * 0.55)) return 0;
    if (gap > Math.min(stepTuning.maxGap * 1.5, typical * 2.3)) {
      // the walk had stopped, this bounce may be the start of a new one
      this.walking = false;
      this.gaps = [];
      this.stopped();
      return this.bounce(t);
    }
    this.gaps = [...this.gaps.slice(-3), gap];
    this.last = t;
    return 1;
  }

  private expectedStep(t: number) {
    const gap = t - this.last;
    if (gap < stepTuning.minGap) return 0;
    if (gap > stepTuning.maxGap) {
      if (this.run >= 2 && this.oneWalk) {
        // the expected walk is over, this bounce has to prove itself like any other
        this.stopped();
        return this.startWalk(t);
      }
      // a first bounce: held back until a second one follows, so a lone bump is no step
      this.run = 1;
      this.last = t;
      this.gaps = [];
      this.pending = [t];
      return 0;
    }
    const count = this.run === 1 ? 2 : 1;
    this.run++;
    this.pending = [];
    this.gaps = [...this.gaps.slice(-3), gap];
    this.last = t;
    if (this.gaps.length >= stepTuning.confirm - 1 && isSteady(this.gaps.slice(1 - stepTuning.confirm))) this.walking = true;
    return count;
  }

  private stopped() {
    this.run = 0;
    if (this.oneWalk) this.expecting = false;
  }

  private startWalk(t: number) {
    const previous = this.pending.at(-1);
    if (previous !== undefined && t - previous < stepTuning.minGap) return 0;
    if (previous === undefined || t - previous > stepTuning.maxGap) this.pending = [];
    this.pending.push(t);
    if (this.pending.length > stepTuning.confirm) this.pending.shift();
    if (this.pending.length < stepTuning.confirm) return 0;

    const gaps = this.pending.slice(1).map((time, i) => time - this.pending[i]);
    // no steady rhythm yet, the window slides on with the next bounce
    if (!isSteady(gaps)) return 0;
    const count = this.pending.length;
    this.walking = true;
    this.gaps = gaps;
    this.last = t;
    this.pending = [];
    return count;
  }
}

// replays recorded sensor readings, used by the tests and the sensor test page
export function countSteps(samples: RawMotion[]) {
  const counter = new StepCounter();
  return samples.reduce((total, raw) => total + counter.push(sampleFrom(raw)), 0);
}

export function watchMotion(onMotion: (raw: RawMotion) => void) {
  if (typeof window === "undefined") return () => {};
  function handle(event: DeviceMotionEvent) {
    const a = event.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    const r = event.rotationRate;
    // our own clock: safari's event.timeStamp is not reliable for motion events
    onMotion([performance.now(), a.x, a.y, a.z, r?.alpha ?? 0, r?.beta ?? 0, r?.gamma ?? 0]);
  }
  window.addEventListener("devicemotion", handle);
  return () => window.removeEventListener("devicemotion", handle);
}
