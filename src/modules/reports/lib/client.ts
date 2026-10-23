"use client";

import type { Hazard, Problem, RecordingRequest, Spot, TempObstacle } from "@/core/map";
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

export function useObstacles(intervalMs = 5000) {
  return usePolledJson<TempObstacle[]>("/api/obstacles", intervalMs) ?? [];
}

export function fetchObstacles() {
  return requestJson<TempObstacle[]>("/api/obstacles");
}

export function addObstacle(input: { mapId: string; name: string; x: number; y: number; radius: number; hours: number; reportedBy: string; hazard?: Hazard | null }) {
  return requestJson<TempObstacle>("/api/obstacles", { method: "POST", body: JSON.stringify(input) });
}

export function removeObstacle(id: string) {
  return requestJson<TempObstacle[]>("/api/obstacles", { method: "PATCH", body: JSON.stringify({ id }) });
}

// as an obstacle of the map, so routes go round it and warn about it like any other
export function obstacleSpot(o: TempObstacle): Spot {
  return { id: `t-${o.id.slice(0, 8)}`, kind: "obstacle", name: o.name, x: o.x, y: o.y, radius: o.radius, heading: null, photo: "", thumb: "", videoTime: 0, ...(o.hazard ? { hazard: o.hazard } : {}) };
}
