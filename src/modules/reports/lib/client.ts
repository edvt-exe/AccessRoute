"use client";

import type { Problem, RecordingRequest } from "@/core/map";
import { requestJson, usePolledJson } from "@/core/storage/client";

export function useProblems(intervalMs = 5000) {
  return usePolledJson<Problem[]>("/api/problems", intervalMs) ?? [];
}

export function fetchProblems() {
  return requestJson<Problem[]>("/api/problems");
}

export function reportProblem(input: { mapId: string; placeId: string; reason: string; reportedBy: string }) {
  return requestJson<Problem>("/api/problems", { method: "POST", body: JSON.stringify(input) });
}

export function resolveProblem(id: string) {
  return requestJson<Problem[]>("/api/problems", { method: "PATCH", body: JSON.stringify({ id }) });
}

export function useRecordingRequests(onChange?: (next: RecordingRequest[], previous: RecordingRequest[] | null) => void) {
  return usePolledJson<RecordingRequest[]>("/api/requests", 10000, onChange) ?? [];
}

export function requestRecording(note: string) {
  return requestJson<RecordingRequest>("/api/requests", { method: "POST", body: JSON.stringify({ note }) });
}

export function markRequestDone(id: string) {
  return requestJson<RecordingRequest[]>("/api/requests", { method: "PATCH", body: JSON.stringify({ id }) });
}
