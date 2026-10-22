"use client";

type PermissionApi = { requestPermission?: () => Promise<"granted" | "denied"> };

async function ask(api: unknown) {
  const event = api as PermissionApi | undefined;
  if (!event || typeof event.requestPermission !== "function") return true;
  try {
    return (await event.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

// ios shows the motion prompt only when asked from inside a tap, both calls start synchronously
export async function requestMotionPermission() {
  if (typeof window === "undefined") return false;
  const orientation = ask(typeof DeviceOrientationEvent === "undefined" ? undefined : DeviceOrientationEvent);
  const motion = ask(typeof DeviceMotionEvent === "undefined" ? undefined : DeviceMotionEvent);
  const [a, b] = await Promise.all([orientation, motion]);
  return a && b;
}

const rad = Math.PI / 180;

// direction of the back camera. held upright, the classic 360 - alpha formula points at the sky,
// so the camera axis is rotated into world coordinates first
export function headingFromOrientation(alpha: number, beta: number, gamma: number) {
  const ca = Math.cos(alpha * rad);
  const sa = Math.sin(alpha * rad);
  const cb = Math.cos(beta * rad);
  const sb = Math.sin(beta * rad);
  const cg = Math.cos(gamma * rad);
  const sg = Math.sin(gamma * rad);
  const x = -ca * sg - sa * sb * cg;
  const y = -sa * sg + ca * sb * cg;
  const z = -cb * cg;
  const heading = Math.abs(z) > 0.8 ? 360 - alpha : (Math.atan2(x, y) * 180) / Math.PI;
  return ((heading % 360) + 360) % 360;
}

// the plain deviceorientation event comes from the gyroscope, it is not thrown off by metal
// in the building like the compass is. its zero is arbitrary, so callers anchor it at a known direction
export function watchHeading(onHeading: (heading: number) => void) {
  if (typeof window === "undefined") return () => {};
  function handle(raw: Event) {
    const event = raw as DeviceOrientationEvent;
    if (event.alpha === null || event.beta === null || event.gamma === null) return;
    onHeading(headingFromOrientation(event.alpha, event.beta, event.gamma));
  }
  window.addEventListener("deviceorientation", handle);
  return () => window.removeEventListener("deviceorientation", handle);
}
