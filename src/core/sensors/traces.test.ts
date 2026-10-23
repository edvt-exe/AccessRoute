import { existsSync, readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { countSteps } from "./steps";
import { traceSchema } from "./trace";

// real recordings from /staff/sensors, copied here from .data/traces/. synthetic signals are too clean
// to show what a hand does to the sensors, these are what the counter is tuned against
const folder = path.join(__dirname, "__traces__");
const files = existsSync(folder) ? readdirSync(folder).filter((f) => f.endsWith(".json")).sort() : [];

describe("recorded sensor traces", () => {
  if (files.length === 0) {
    it.skip("none recorded yet: record some on /staff/sensors and copy them into src/core/sensors/__traces__", () => {});
    return;
  }

  it.each(files)("%s", (file) => {
    const trace = traceSchema.parse(JSON.parse(readFileSync(path.join(folder, file), "utf8")));
    const counted = countSteps(trace.samples);
    // standing still must give no step at all, a walk may be off by a step or two
    const tolerance = trace.expectedSteps === 0 ? 0 : Math.max(2, Math.round(trace.expectedSteps * 0.1));
    expect(
      Math.abs(counted - trace.expectedSteps),
      `${trace.scenario}${trace.note ? ` (${trace.note})` : ""}: counted ${counted} steps, expected ${trace.expectedSteps}`,
    ).toBeLessThanOrEqual(tolerance);
  });
});
