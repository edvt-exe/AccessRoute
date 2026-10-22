import { z } from "zod";
import { callClaudeJson, hasClaude } from "@/core/ai/claude";
import { advance, clampInside, headingBetween, mapIdSchema, normalizeHeading, pointAlongOutline, type Point } from "@/core/map";
import { loadMap, loadViews } from "@/core/storage/maps";

export const locateInput = z.object({
  mapId: mapIdSchema,
  frames: z.array(z.string().startsWith("data:image/jpeg;base64,").max(300_000)).min(1).max(2),
});

const answerSchema = z.object({
  id: z.string(),
  confidence: z.number(),
  facing: z.enum(["same", "opposite"]),
});

export type LocateResult =
  | { ok: true; position: Point; facing: number; nearSpotId: string | null; confidence: number }
  | { ok: false; reason: "ai-off" | "not-found" | "no-map" | "error" };

const system = `You help a blind person find where they are in one room of an office building.
You get reference photos of the room, each with an id. They were taken by a colleague walking through the room:
along the walls, between the furniture, and in front of named places and obstacles.
Then you get one or two new photos from the blind person's phone, held at chest height.
Find the reference photo taken from the most similar position and direction. Use fixed features (doors, windows,
walls, signs, furniture, floor and ceiling), ignore people and anything that moves.
facing: "same" if the new photo looks roughly the same way as that reference, "opposite" if it clearly looks back
the other way. If nothing matches, answer id "none".
confidence: 0 to 1. Be strict, a wrong answer sends a blind person the wrong way.
Answer only with the json, no explanation.`;

const maxSpots = 12;
const minConfidence = 0.55;

type Reference = { id: string; label: string; image: string; position: Point; heading: number; spotId: string | null };

export async function locate(input: z.infer<typeof locateInput>): Promise<LocateResult> {
  if (!hasClaude()) return { ok: false, reason: "ai-off" };
  const map = await loadMap(input.mapId);
  if (!map) return { ok: false, reason: "no-map" };
  const views = await loadViews(map.id);
  const middle = {
    x: map.outline.reduce((sum, p) => sum + p.x, 0) / map.outline.length,
    y: map.outline.reduce((sum, p) => sum + p.y, 0) / map.outline.length,
  };

  const references: Reference[] = [
    ...map.spots
      .filter((s) => s.heading !== null)
      .slice(0, maxSpots)
      .map((s) => ({
        id: s.id,
        label: `${s.id} (in front of ${s.kind === "obstacle" ? "the obstacle" : "the place"} "${s.name}")`,
        image: s.thumb,
        // the photo was taken where the colleague stood, a little before the spot
        position: s.id === map.spots[0].id ? { x: s.x, y: s.y } : advance(s, s.heading! + 180, s.kind === "obstacle" ? 0.4 + s.radius : 0.5),
        heading: s.heading!,
        spotId: s.id,
      })),
    ...views.map((v) => {
      // wall photos follow the walls, also after a reviewer changed them
      const where = v.along === null ? null : pointAlongOutline(map.outline, v.along);
      const position = where ? clampInside(where.point, map.outline, 0.5) : { x: v.x, y: v.y };
      return {
        id: v.id,
        label: v.intoRoom ? `${v.id} (from a corner, looking into the room)` : v.id,
        image: v.image,
        position,
        // from a corner the photo looks towards the middle of the room
        heading: v.intoRoom ? headingBetween(position, middle) : where ? where.heading : v.heading,
        spotId: null,
      };
    }),
  ];

  try {
    const answer = await callClaudeJson(answerSchema, {
      task: `locate in ${map.id} (${references.length} references)`,
      system,
      prompt: `Which reference photo matches best? Answer with its id or "none".`,
      images: [
        ...references.map((r) => ({ dataUrl: r.image, label: r.label })),
        ...input.frames.map((dataUrl, i) => ({ dataUrl, label: `New photo ${i + 1} from the person:` })),
      ],
      maxTokens: 400,
    });
    const match = references.find((r) => r.id === answer.id);
    if (!match || answer.confidence < minConfidence) return { ok: false, reason: "not-found" };
    return {
      ok: true,
      position: clampInside(match.position, map.outline, 0.3),
      facing: answer.facing === "same" ? match.heading : normalizeHeading(match.heading + 180),
      nearSpotId: match.spotId,
      confidence: answer.confidence,
    };
  } catch (error) {
    console.error("[ai] locate failed", error);
    return { ok: false, reason: "error" };
  }
}
