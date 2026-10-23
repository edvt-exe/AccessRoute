import { z } from "zod";
import { mapIdSchema, type TempObstacle } from "@/core/map";
import { readJson, writeJson } from "@/core/storage/blob";

const file = "state/obstacles.json";

export const obstacleInput = z.object({
  mapId: mapIdSchema,
  name: z.string().trim().min(2).max(60),
  x: z.number().min(-500).max(500),
  y: z.number().min(-500).max(500),
  radius: z.number().min(0.2).max(3),
  hours: z.number().min(0.25).max(24 * 14),
  reportedBy: z.string().trim().max(60),
  hazard: z.enum(["glass", "stairs", "head"]).nullable().optional(),
});

export const removeInput = z.object({ id: z.string().uuid() });

async function all() {
  return (await readJson<TempObstacle[]>(file)) ?? [];
}

const active = (o: TempObstacle, now = Date.now()) => !o.removed && Date.parse(o.until) > now;

// only what is still in the way: removed or expired ones are left out
export async function getObstacles() {
  return (await all()).filter((o) => active(o));
}

export async function addObstacle(input: z.infer<typeof obstacleInput>) {
  const now = Date.now();
  const { hours, ...rest } = input;
  const obstacle: TempObstacle = {
    id: crypto.randomUUID(),
    ...rest,
    until: new Date(now + hours * 3600 * 1000).toISOString(),
    at: new Date(now).toISOString(),
    removed: false,
  };
  // the file keeps a week of history and nothing older
  const weekAgo = now - 7 * 24 * 3600 * 1000;
  const kept = (await all()).filter((o) => active(o, now) || Date.parse(o.until) > weekAgo);
  await writeJson(file, [...kept, obstacle]);
  return obstacle;
}

export async function removeObstacle(id: string) {
  const next = (await all()).map((o) => (o.id === id ? { ...o, removed: true } : o));
  await writeJson(file, next);
  return next.filter((o) => active(o));
}
