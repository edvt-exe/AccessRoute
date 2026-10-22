import { z } from "zod";
import type { RecordingRequest } from "@/core/map";
import { readJson, writeJson } from "@/core/storage/blob";

const file = "state/requests.json";

export const requestInput = z.object({ note: z.string().trim().max(200) });
export const doneInput = z.object({ id: z.string().uuid() });

export async function getRequests() {
  return (await readJson<RecordingRequest[]>(file)) ?? [];
}

export async function addRequest(note: string) {
  const requests = await getRequests();
  const request: RecordingRequest = { id: crypto.randomUUID(), note: note || "No details given", at: new Date().toISOString(), done: false };
  await writeJson(file, [...requests.filter((r) => !r.done).slice(-50), request]);
  return request;
}

export async function markRequestDone(id: string) {
  const requests = await getRequests();
  const next = requests.map((r) => (r.id === id ? { ...r, done: true } : r));
  await writeJson(file, next);
  return next;
}
