// counts steps from the up and down bounce of a phone held in front of the body.
// the threshold follows the size of the bounce, so a gentle walk with the phone held
// steady counts as well as a brisk one, while hand tremor stays below the floor
export class StepDetector {
  private baseline: number | null = null;
  private smooth = 0;
  private amplitude = 0.5;
  private above = false;
  private lastStep = -Infinity;

  push(magnitude: number, timeMs: number) {
    this.baseline = this.baseline === null ? magnitude : this.baseline * 0.97 + magnitude * 0.03;
    const bounce = magnitude - this.baseline;
    this.smooth = this.smooth * 0.6 + bounce * 0.4;
    this.amplitude = this.amplitude * 0.98 + Math.abs(this.smooth) * 0.02;
    const threshold = Math.max(0.35, this.amplitude * 0.9);

    // 330 ms between steps: fast walking is about 2.2 steps per second, heel and toe come closer
    if (!this.above && this.smooth > threshold && timeMs - this.lastStep > 330) {
      this.above = true;
      this.lastStep = timeMs;
      return true;
    }
    if (this.above && this.smooth < threshold * 0.3) this.above = false;
    return false;
  }
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
