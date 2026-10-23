"use client";

import type { Hazard, Tour } from "@/core/map";
import { requestJson } from "@/core/storage/client";

// browser side calls of the assistant: every answer has a plain fallback, the app also works without the ai

export type HazardSuggestion = { name: string; reason: string; hazard: Hazard | null; x: number; y: number; photo: string };
export type Analysis = { ok: true; descriptions: Record<string, string>; hazards: HazardSuggestion[] } | { ok: false; reason: string };

export function analyseRoom(mapId: string) {
  return requestJson<Analysis>("/api/assistant/analyse", { method: "POST", body: JSON.stringify({ mapId }) });
}

export async function phraseInstructions(sentences: string[], destination: string) {
  const result = await requestJson<{ sentences: (string | null)[] }>("/api/assistant/phrase", {
    method: "POST",
    body: JSON.stringify({ sentences, destination }),
  });
  return result.sentences;
}

export type AskResult =
  | { ok: true; intent: "go"; mapId: string; spotId: string; say: string }
  | { ok: true; intent: "answer" | "look" | "tour" | "help" | "unknown"; say: string; tourId?: string }
  | { ok: false; reason: string };

export function askAssistant(text: string) {
  return requestJson<AskResult>("/api/assistant/ask", { method: "POST", body: JSON.stringify({ text }) });
}

export function describeView(image: string, wide: boolean) {
  return requestJson<{ ok: true; say: string } | { ok: false; reason: string }>("/api/assistant/look", {
    method: "POST",
    body: JSON.stringify({ image, wide }),
  });
}

export function fetchTours() {
  return requestJson<Tour[]>("/api/assistant/tour");
}

export function createTour(input: { guest: string; stops: { mapId: string; spotId: string }[]; createdBy: string }) {
  return requestJson<{ ok: true; tour: Tour } | { ok: false; reason: string }>("/api/assistant/tour", { method: "POST", body: JSON.stringify(input) });
}

export function deleteTour(id: string) {
  return requestJson<Tour[]>("/api/assistant/tour", { method: "DELETE", body: JSON.stringify({ id }) });
}

export function judgeAnswer(question: string, expected: string, heard: string) {
  return requestJson<{ correct: boolean; say: string }>("/api/assistant/quiz", { method: "POST", body: JSON.stringify({ question, expected, heard }) });
}

export type ReportItem = { room: string; finding: string; why: string; fix: string; priority: "high" | "medium" | "low" };
export type Report = { summary: string; items: ReportItem[]; ai: boolean; createdAt: string };

export function buildReport() {
  return requestJson<Report>("/api/assistant/report", { method: "POST" });
}
