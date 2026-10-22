import { z } from "zod";
import { mapIdSchema, type Problem } from "@/core/map";
import { readJson, writeJson } from "@/core/storage/blob";

const file = "state/problems.json";

export const reportInput = z.object({
  mapId: mapIdSchema,
  placeId: z.string().min(1).max(40),
  reason: z.string().trim().min(2).max(120),
  reportedBy: z.string().trim().max(60),
});

export const resolveInput = z.object({ id: z.string().uuid() });

export async function getProblems() {
  return (await readJson<Problem[]>(file)) ?? [];
}

export async function reportProblem(input: z.infer<typeof reportInput>) {
  const problems = await getProblems();
  const problem: Problem = { id: crypto.randomUUID(), ...input, at: new Date().toISOString(), resolved: false };
  const weekAgo = Date.now() - 7 * 24 * 3600 * 1000;
  // fixed problems older than a week are dropped so the file stays small
  const kept = problems.filter((p) => !p.resolved || Date.parse(p.at) > weekAgo);
  await writeJson(file, [...kept, problem]);
  return problem;
}

export async function resolveProblem(id: string) {
  const problems = await getProblems();
  const next = problems.map((p) => (p.id === id ? { ...p, resolved: true } : p));
  await writeJson(file, next);
  return next;
}
