const grid = 20; // ms between samples of the rhythm buffer
const span = 3000; // ms of walking the rhythm is measured on

// counts steps from the up and down bounce of a phone held in front of the body.
// a real step is not a smooth wave: the heel strikes, the phone bounces back and the foot pushes off,
// and in a slow walk the push-off makes a second peak as big as the first. so the rhythm of the walk is
// measured (the time after which the signal repeats itself) and only one peak per rhythm is a step
export class StepDetector {
  private baseline: number | null = null;
  private smooth = 0;
  private amplitude = 0.5;
  private above = false;
  private lastStep = -Infinity;
  private lastTime: number | null = null;
  private samples: number[] = [];
  private nextSample = 0;
  private period: number | null = null;
  private periodAt = -Infinity;
  private nextRhythm = 0;

  push(magnitude: number, timeMs: number) {
    // time based, so it behaves the same at 60 or 100 readings a second
    const dt = this.lastTime === null ? 16 : Math.min(100, Math.max(4, timeMs - this.lastTime));
    this.lastTime = timeMs;
    this.baseline = this.baseline === null ? magnitude : this.baseline + (magnitude - this.baseline) * (1 - Math.exp(-dt / 1000));
    const bounce = magnitude - this.baseline;
    this.smooth += (bounce - this.smooth) * (1 - Math.exp(-dt / 40));
    this.amplitude += (Math.abs(this.smooth) - this.amplitude) * (1 - Math.exp(-dt / 800));
    this.record(timeMs);
    const threshold = Math.max(0.3, this.amplitude * 0.9);

    // brisk walking is about 2.3 steps a second; with a known rhythm nothing closer than 70% of a step counts
    const gap = this.period ? Math.max(380, this.period * 0.7) : 420;
    if (!this.above && this.smooth > threshold && timeMs - this.lastStep > gap) {
      this.above = true;
      this.lastStep = timeMs;
      return true;
    }
    if (this.above && this.smooth < threshold * 0.3) this.above = false;
    return false;
  }

  // readings come at the phone's own pace, the rhythm buffer keeps one value every 20 ms
  private record(timeMs: number) {
    if (timeMs < this.nextSample) return;
    if (timeMs - this.nextSample > span) this.nextSample = timeMs;
    while (this.nextSample <= timeMs) {
      this.samples.push(this.smooth);
      this.nextSample += grid;
    }
    while (this.samples.length > span / grid) this.samples.shift();
    if (timeMs >= this.nextRhythm) {
      this.nextRhythm = timeMs + 250;
      // standing still has no rhythm; the person's own rhythm is kept for the next stretch of walking
      const found = rhythm(this.samples);
      if (found) {
        this.period = found;
        this.periodAt = timeMs;
      } else if (timeMs - this.periodAt > 60000) {
        this.period = null;
      }
    }
  }
}

// the step time of a walk, from how the signal repeats itself. the strongest repeat is a step, or a
// stride (left and right foot) when the two feet differ; a stride is recognised by a strong repeat at
// half its length. a push-off peak inside a step sits off the half, so it is never taken for a step
export function rhythm(samples: number[]) {
  if (samples.length < 1500 / grid) return null;
  const mean = samples.reduce((a, b) => a + b, 0) / samples.length;
  const x = samples.map((v) => v - mean);
  const energy = x.reduce((a, v) => a + v * v, 0);
  if (energy === 0) return null;
  // only a window that is walking from end to end: starting or stopping would fake a rhythm
  const firstHalf = x.slice(0, x.length / 2).reduce((a, v) => a + v * v, 0);
  if (firstHalf < energy * 0.3 || firstHalf > energy * 0.7) return null;
  // walking swings up and down at least once a second
  const crossings = x.filter((v, i) => i > 0 && Math.sign(v) !== Math.sign(x[i - 1])).length;
  if (crossings < (x.length * grid) / 1000) return null;
  const scores: { lag: number; r: number }[] = [];
  for (let lag = 400 / grid; lag <= 1300 / grid && lag < x.length / 2; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < x.length; i++) sum += x[i] * x[i + lag];
    scores.push({ lag, r: (sum / energy) * (x.length / (x.length - lag)) });
  }
  // a real repeat is a peak with a lower value on both sides; a slow drift only slopes down from the start
  const peaks = scores.filter((s, i) => i > 0 && i < scores.length - 1 && scores[i - 1].r <= s.r && scores[i + 1].r <= s.r && s.r > 0);
  if (peaks.length === 0) return null;
  const best = peaks.reduce((a, b) => (b.r > a.r ? b : a));
  // no clear rhythm: standing, or turning on the spot
  if (best.r < 0.3) return null;
  // a step shorter than 420 ms (over 2.4 steps a second) is running, not walking: that half is a push-off
  const half = peaks.find((p) => Math.abs(p.lag * 2 - best.lag) <= best.lag * 0.12 && p.r >= best.r * 0.6 && p.lag * grid >= 420);
  return (half ?? best).lag * grid;
}

// a real walk is a train of steps. a single bump (lifting the phone, tilting it to look at the
// screen, putting it down) is held back and dropped unless another step follows soon after
export class StepTrain {
  private pending: number | null = null;
  private last = -Infinity;
  private quietUntil = -Infinity;

  constructor(private gap = 1600) {}

  // the phone is being tilted, any bounce now comes from the hand and not from the feet
  tilting(timeMs: number) {
    this.quietUntil = timeMs + 300;
    this.pending = null;
  }

  // returns how many steps to count now
  step(timeMs: number): number {
    if (timeMs < this.quietUntil) return 0;
    if (timeMs - this.last <= this.gap) {
      this.last = timeMs;
      const count = this.pending === null ? 1 : 2;
      this.pending = null;
      return count;
    }
    this.pending = timeMs;
    this.last = timeMs;
    return 0;
  }
}

export function watchSteps(onStep: () => void, onMotion?: () => void) {
  if (typeof window === "undefined") return () => {};
  const detector = new StepDetector();
  const train = new StepTrain();
  function handle(event: DeviceMotionEvent) {
    const a = event.accelerationIncludingGravity;
    if (!a || a.x === null || a.y === null || a.z === null) return;
    onMotion?.();
    // our own clock: safari's event.timeStamp is not reliable for motion events
    const now = performance.now();
    // beta is the rotation that tilts the phone forwards and backwards, turning the body is another axis
    if (Math.abs(event.rotationRate?.beta ?? 0) > 80) train.tilting(now);
    if (!detector.push(Math.hypot(a.x, a.y, a.z), now)) return;
    for (let i = train.step(now); i > 0; i--) onStep();
  }
  window.addEventListener("devicemotion", handle);
  return () => window.removeEventListener("devicemotion", handle);
}
