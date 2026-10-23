import { z } from "zod";
import { callClaudeJson, hasClaude } from "@/core/ai/claude";
import { advance, clampInside, headingBetween, mapIdSchema, pointAlongOutline, type Hazard, type Point } from "@/core/map";
import { loadMap, loadViews } from "@/core/storage/maps";

export const analyseInput = z.object({ mapId: mapIdSchema });

const answerSchema = z.object({
  places: z.array(z.object({ id: z.string(), description: z.string() })),
  hazards: z.array(
    z.object({
      photo: z.string(),
      name: z.string(),
      kind: z.enum(["obstacle", "head", "stairs", "glass", "cable", "drawer"]),
      reason: z.string(),
    }),
  ),
});

export type HazardSuggestion = { name: string; reason: string; hazard: Hazard | null; x: number; y: number; photo: string };
export type Analysis = { ok: true; descriptions: Record<string, string>; hazards: HazardSuggestion[] } | { ok: false; reason: "ai-off" | "no-map" | "error" };

const system = `You help make an office room usable for a blind colleague. A colleague walked through the room with a phone.
You get the photos of the named places (id, name) and some photos taken along the walls (ids starting with v).
1. For every named place, write one short factual description, at most 20 words, that helps someone who cannot see
   find and use it by touch: material, which side a handle or button is on, what is next to it, signs and their text.
   Only what is clearly visible. Never describe people.
2. List hazards that a white cane does not find well or that need care: things at head height (shelves, signs, open
   cupboard doors), stairs or single steps, glass doors or walls, cables on the floor, open drawers, things standing in
   the way. Give the id of the photo where you see it, a short name, the kind and why it matters.
   Only real hazards you can clearly see; an empty list is fine.
Answer only with the json.`;

// the ai looks at the recording once, a colleague then checks what it wrote and what it found
export async function analyseMap(input: z.infer<typeof analyseInput>): Promise<Analysis> {
  if (!hasClaude()) return { ok: false, reason: "ai-off" };
  const map = await loadMap(input.mapId);
  if (!map) return { ok: false, reason: "no-map" };
  const places = map.spots.filter((s) => s.photo);
  const views = (await loadViews(map.id)).slice(0, 24);
  const middle = { x: map.outline.reduce((a, p) => a + p.x, 0) / map.outline.length, y: map.outline.reduce((a, p) => a + p.y, 0) / map.outline.length };
  // where each photo was taken from and which way it looked, to put a hazard on the map
  const where = new Map<string, { at: Point; heading: number }>();
  for (const s of places) where.set(s.id, { at: s.heading === null ? s : advance(s, s.heading + 180, 1), heading: s.heading ?? 0 });
  for (const v of views) {
    const on = v.along === null ? null : pointAlongOutline(map.outline, v.along);
    const at = on ? clampInside(on.point, map.outline, 0.5) : { x: v.x, y: v.y };
    where.set(v.id, { at, heading: v.intoRoom ? headingBetween(at, middle) : on ? on.heading : v.heading });
  }
  try {
    const answer = await callClaudeJson(answerSchema, {
      task: `analyse ${map.id} (${places.length} places, ${views.length} views)`,
      system,
      prompt: `Describe the ${places.length} places and list the hazards.`,
      images: [
        ...places.map((s) => ({ dataUrl: s.photo, label: `Place ${s.id}: "${s.name}"${s.door ? " (a door)" : s.kind === "obstacle" ? " (an obstacle)" : ""}` })),
        ...views.map((v) => ({ dataUrl: v.image, label: `Photo ${v.id}` })),
      ],
      maxTokens: 2500,
    });
    const descriptions: Record<string, string> = {};
    for (const p of answer.places) if (places.some((s) => s.id === p.id) && p.description.trim()) descriptions[p.id] = p.description.trim().slice(0, 300);
    const hazards: HazardSuggestion[] = [];
    for (const h of answer.hazards) {
      const seen = where.get(h.photo.trim());
      if (!seen) continue;
      // about two metres in front of where the photo was taken
      const at = clampInside(advance(seen.at, seen.heading, 2), map.outline, 0.3);
      const hazard: Hazard | null = h.kind === "head" || h.kind === "stairs" || h.kind === "glass" ? h.kind : null;
      hazards.push({ name: h.name.slice(0, 60), reason: h.reason.slice(0, 200), hazard, x: Math.round(at.x * 100) / 100, y: Math.round(at.y * 100) / 100, photo: h.photo });
    }
    return { ok: true, descriptions, hazards };
  } catch (error) {
    console.error("[ai] analyse failed", error);
    return { ok: false, reason: "error" };
  }
}
