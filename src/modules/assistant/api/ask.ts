import { z } from "zod";
import { callClaudeJson, hasClaude } from "@/core/ai/claude";
import { loadPublishedMaps } from "@/core/storage/maps";
import { listTours } from "./tour";

export const askInput = z.object({ text: z.string().trim().min(1).max(300) });

const answerSchema = z.object({
  intent: z.enum(["go", "answer", "look", "tour", "help", "unknown"]),
  place: z.string(),
  say: z.string(),
});

export type AskResult =
  | { ok: true; intent: "go"; mapId: string; spotId: string; say: string }
  | { ok: true; intent: "answer" | "look" | "tour" | "help" | "unknown"; say: string; tourId?: string }
  | { ok: false; reason: "ai-off" | "error" };

const system = `You are the voice assistant of AccessRoute, an app that guides a blind colleague inside their office.
You get the places on the map, with their room and a short description, and what the person just said.
Decide what they want:
- "go": they want to go somewhere or need something a place has ("where can I get coffee", "I need the toilet",
  "take me to Maria's desk"). Put the place id in place. In say, one short sentence naming the place, for example
  "The coffee machine is in the kitchen." Only choose a place from the list.
- "answer": a question about the places you can answer from the list, without going there ("which rooms are
  there?", "is there a printer?"). Answer in say, at most 35 words. Do not invent anything that is not in the list.
- "look": they want to know what is around them or in front of them right now.
- "tour": they want the first-day tour, a tour of the office, or a quiz.
- "help": they want help with the app or the tutorial.
- "unknown": anything else; in say, briefly say what you can do.
place is "" when intent is not "go". Answer only with the json.`;

export async function ask(input: z.infer<typeof askInput>): Promise<AskResult> {
  if (!hasClaude()) return { ok: false, reason: "ai-off" };
  const maps = await loadPublishedMaps();
  const lines = maps.flatMap((map) =>
    map.spots
      .filter((s) => s.kind === "place")
      .map((s, i) => `${map.id}/${s.id}: "${s.name}" in room "${map.name}"${i === 0 ? " (entrance)" : s.door ? " (door)" : ""}${s.description ? ` – ${s.description}` : ""}`),
  );
  const tours = await listTours();
  try {
    const answer = await callClaudeJson(answerSchema, {
      task: "ask",
      system,
      prompt: `Places:\n${lines.join("\n") || "(none yet)"}\n${tours.length ? "A first-day tour is ready." : "No tour has been prepared."}\n\nThe person said: "${input.text}"`,
      maxTokens: 700,
    });
    if (answer.intent === "go") {
      const [mapId, spotId] = answer.place.trim().split("/");
      const map = maps.find((m) => m.id === mapId);
      if (map?.spots.some((s) => s.id === spotId && s.kind === "place")) return { ok: true, intent: "go", mapId, spotId, say: answer.say.trim() };
      return { ok: true, intent: "unknown", say: "I am not sure which place you mean." };
    }
    return { ok: true, intent: answer.intent, say: answer.say.trim(), ...(answer.intent === "tour" && tours[0] ? { tourId: tours[0].id } : {}) };
  } catch (error) {
    console.error("[ai] ask failed", error);
    return { ok: false, reason: "error" };
  }
}
