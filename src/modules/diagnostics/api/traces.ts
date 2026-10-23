import { localRoot, useBlob, writeJson } from "@/core/storage/blob";
import type { SensorTrace } from "@/core/sensors/trace";

export { traceSchema as traceInput } from "@/core/sensors/trace";

function traceId(scenario: string, at: Date) {
  const stamp = at.toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  return `${scenario}-${stamp}-${Math.random().toString(36).slice(2, 6)}`;
}

// sensor recordings for tuning the step counter. locally they land in .data/traces/, next to the dev server
export async function saveTrace(trace: SensorTrace) {
  const id = traceId(trace.scenario, new Date());
  const pathname = `traces/${id}.json`;
  await writeJson(pathname, trace);
  return { id, savedTo: useBlob ? `blob store: ${pathname}` : `${localRoot}/${pathname}` };
}
