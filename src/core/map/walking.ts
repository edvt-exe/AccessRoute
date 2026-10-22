export const defaultStepLength = 0.7; // metres, an average adult step

export function normalizeHeading(degrees: number) {
  return ((degrees % 360) + 360) % 360;
}

// signed difference in degrees, positive means turn right (clockwise)
export function turnAngle(from: number, to: number) {
  const diff = normalizeHeading(to - from);
  return diff > 180 ? diff - 360 : diff;
}

export function averageHeading(samples: number[]) {
  if (samples.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const deg of samples) {
    x += Math.sin((deg * Math.PI) / 180);
    y += Math.cos((deg * Math.PI) / 180);
  }
  // samples pointing everywhere (spinning around) give no useful direction
  if (Math.hypot(x, y) / samples.length < 0.5) return null;
  return normalizeHeading(Math.round((Math.atan2(x, y) * 180) / Math.PI));
}

export function describeTurn(angle: number) {
  const size = Math.abs(angle);
  const side = angle > 0 ? "right" : "left";
  if (size < 25) return null;
  if (size < 60) return `Turn slightly ${side}.`;
  if (size < 135) return `Turn ${side}.`;
  return "Turn around.";
}

export function stepsFor(metres: number, stepLength = defaultStepLength) {
  return Math.max(1, Math.round(metres / stepLength));
}
