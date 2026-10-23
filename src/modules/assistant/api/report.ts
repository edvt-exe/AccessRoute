import { z } from "zod";
import { callClaudeJson, hasClaude } from "@/core/ai/claude";

export type RoomFacts = { room: string; facts: string[] };

const reportSchema = z.object({
  summary: z.string(),
  items: z.array(
    z.object({
      room: z.string(),
      finding: z.string(),
      why: z.string(),
      fix: z.string(),
      priority: z.enum(["high", "medium", "low"]),
    }),
  ),
});

export type Report = z.infer<typeof reportSchema> & { ai: boolean; createdAt: string };

const system = `You write an accessibility report for an employer, about how ready their office is for a new blind
colleague who will use a guiding app. You get facts measured from the app's maps, room by room.
- summary: at most 60 words, plain and constructive, what works and what matters most
- items: one per fact worth acting on: the room, the finding in plain words, why it matters for a blind person,
  a concrete, cheap fix (move it, mark it with a tactile strip, add a label, record the map again...) and a priority
  (high: can hurt someone, medium: slows them down, low: comfort)
Use only the facts you get, add none, and keep every number as it is. Highest priority first. Answer only with the json.`;

export async function writeReport(rooms: RoomFacts[]): Promise<Report> {
  const createdAt = new Date().toISOString();
  const plain = (): Report => ({
    summary: `${rooms.reduce((n, r) => n + r.facts.length, 0)} findings in ${rooms.length} rooms.`,
    items: rooms.flatMap((r) => r.facts.map((finding) => ({ room: r.room, finding, why: "", fix: "", priority: "medium" as const }))),
    ai: false,
    createdAt,
  });
  if (!hasClaude() || rooms.every((r) => r.facts.length === 0)) return plain();
  try {
    const answer = await callClaudeJson(reportSchema, {
      task: `report on ${rooms.length} rooms`,
      system,
      prompt: rooms.map((r) => `Room "${r.room}":\n${r.facts.map((f) => `- ${f}`).join("\n") || "- nothing found"}`).join("\n\n"),
      maxTokens: 3000,
    });
    const order = { high: 0, medium: 1, low: 2 };
    return { ...answer, items: answer.items.sort((a, b) => order[a.priority] - order[b.priority]), ai: true, createdAt };
  } catch (error) {
    console.error("[ai] report failed", error);
    return plain();
  }
}
