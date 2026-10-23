"use client";

import type { SensorTrace } from "@/core/sensors/trace";
import { requestJson } from "@/core/storage/client";

export function uploadTrace(trace: SensorTrace) {
  return requestJson<{ id: string; savedTo: string }>("/api/traces", { method: "POST", body: JSON.stringify(trace) });
}

// a copy on the phone, for when the server cannot be reached
export function downloadTrace(trace: SensorTrace, name: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(trace)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
