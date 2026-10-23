import { z } from "zod";
import { callClaudeJson, hasClaude } from "@/core/ai/claude";
import { distance, mapIdSchema, roomRoute, stepsFor, type Tour } from "@/core/map";
import { readJson, writeJson } from "@/core/storage/blob";
import { loadPublishedMaps } from "@/core/storage/maps";

const file = "state/tours.json";

export const tourInput = z.object({
  guest: z.string().trim().min(1).max(60),
  stops: z.array(z.object({ mapId: mapIdSchema, spotId: z.string().max(20) })).min(1).max(8),
  createdBy: z.string().trim().max(60),
});

export const quizInput = z.object({
  question: z.string().max(300),
  expected: z.string().max(300),
  heard: z.string().max(300),
});

const tourSchema = z.object({
  welcome: z.string(),
  stops: z.array(z.string()),
  quiz: z.array(z.object({ question: z.string(), expected: z.string() })),
});

const system = `You write the first-day tour of an office for a new blind colleague, spoken by the guiding app.
You get the guest's name and the stops in order, with their room, a description and how to get from one to the next.
Write:
- welcome: a warm welcome of at most 40 words, using their name, saying how many stops the tour has
- stops: for each stop, in order, one or two sentences said on arrival: what it is, what is useful to know about it,
  what is next to it. Use only the facts you get; at most 40 words each
- quiz: two or three short questions to check they remember the layout, each with the expected answer, for example
  "From your desk, which room do you go through to reach the kitchen?". Every answer must follow from the facts.
Answer only with the json.`;

export async function listTours() {
  return ((await readJson<Tour[]>(file)) ?? []).slice().reverse();
}

export async function createTour(input: z.infer<typeof tourInput>): Promise<{ ok: true; tour: Tour } | { ok: false; reason: "ai-off" | "no-place" | "error" }> {
  if (!hasClaude()) return { ok: false, reason: "ai-off" };
  const maps = await loadPublishedMaps();
  const stops = input.stops
    .map((ref) => {
      const map = maps.find((m) => m.id === ref.mapId);
      const spot = map?.spots.find((s) => s.id === ref.spotId);
      return map && spot ? { ref, map, spot } : null;
    })
    .filter((s) => s !== null);
  if (stops.length === 0) return { ok: false, reason: "no-place" };
  // the facts the ai may use: what each stop is, and the way from the one before
  const facts = stops.map(({ map, spot }, i) => {
    const before = stops[i - 1];
    let way = "";
    if (before) {
      const hops = roomRoute(maps, { mapId: before.map.id, point: before.spot }, { mapId: map.id, spotId: spot.id });
      const through = (hops ?? []).map((h) => maps.find((m) => m.id === h.to.mapId)?.name).filter(Boolean);
      way = through.length
        ? ` From "${before.spot.name}" the way goes through the door${through.length > 1 ? "s" : ""} into ${through.join(", then ")}.`
        : ` It is in the same room as "${before.spot.name}", about ${stepsFor(distance(before.spot, spot))} steps away.`;
    }
    return `${i + 1}. "${spot.name}" in room "${map.name}"${spot.door ? " (a door)" : ""}.${spot.description ? ` ${spot.description}` : ""}${way}`;
  });
  try {
    const answer = await callClaudeJson(tourSchema, {
      task: `tour for ${input.guest} (${stops.length} stops)`,
      system,
      prompt: `Guest: ${input.guest}\nStops:\n${facts.join("\n")}`,
      maxTokens: 1500,
    });
    const tour: Tour = {
      id: crypto.randomUUID(),
      guest: input.guest,
      stops: stops.map((s) => s.ref),
      welcome: answer.welcome.trim(),
      stopTexts: stops.map((s, i) => answer.stops[i]?.trim() || `This is ${s.spot.name}.`),
      quiz: answer.quiz.slice(0, 3).filter((q) => q.question.trim() && q.expected.trim()),
      createdBy: input.createdBy,
      createdAt: new Date().toISOString(),
    };
    const all = (await readJson<Tour[]>(file)) ?? [];
    await writeJson(file, [...all.slice(-19), tour]);
    return { ok: true, tour };
  } catch (error) {
    console.error("[ai] tour failed", error);
    return { ok: false, reason: "error" };
  }
}

export async function removeTour(id: string) {
  const all = (await readJson<Tour[]>(file)) ?? [];
  await writeJson(file, all.filter((t) => t.id !== id));
  return listTours();
}

const judgeSchema = z.object({ correct: z.boolean(), say: z.string() });

// the answer is spoken, so it is judged on its meaning, not its words
export async function judgeAnswer(input: z.infer<typeof quizInput>) {
  if (!hasClaude()) return { correct: false, say: `The answer is: ${input.expected}` };
  try {
    return await callClaudeJson(judgeSchema, {
      task: "quiz",
      system:
        "You check a spoken quiz answer of a blind new colleague learning the office. Judge the meaning, not the words, and be kind. In say, at most 25 words: if right, praise briefly; if wrong or partly right, give the expected answer in plain words. Answer only with the json.",
      prompt: `Question: ${input.question}\nExpected answer: ${input.expected}\nThe person said: "${input.heard}"`,
      maxTokens: 400,
    });
  } catch (error) {
    console.error("[ai] quiz failed", error);
    return { correct: false, say: `The answer is: ${input.expected}` };
  }
}
