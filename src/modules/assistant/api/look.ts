import { z } from "zod";
import { callClaudeJson, hasClaude } from "@/core/ai/claude";

export const lookInput = z.object({
  image: z.string().startsWith("data:image/jpeg;base64,").max(400_000),
  wide: z.boolean().optional(),
});

const answerSchema = z.object({ say: z.string() });

const system = `You are the eyes of a blind person in their office. They hold the phone at chest height and ask
"what is in front of me?". Say what is there in at most 45 words, in plain spoken English:
- first anything that needs care: a step, stairs, glass, something at head height, something on the floor, an open door
- then the main things, with where they are: on the left, straight ahead, on the right, and roughly how far in steps
- read short signs or labels word for word
Never tell the person to walk or move, and never say a way is clear: you only describe. Do not describe people's
looks. If the photo is too dark or blurred, say so.`;

export async function lookAhead(input: z.infer<typeof lookInput>): Promise<{ ok: true; say: string } | { ok: false; reason: "ai-off" | "error" }> {
  if (!hasClaude()) return { ok: false, reason: "ai-off" };
  try {
    const answer = await callClaudeJson(answerSchema, {
      task: "look",
      system,
      prompt: `What is in front of me?${input.wide ? " The photo is from a wide-angle camera, things are closer than they look." : ""}`,
      images: [{ dataUrl: input.image }],
      maxTokens: 600,
    });
    return { ok: true, say: answer.say.trim() };
  } catch (error) {
    console.error("[ai] look failed", error);
    return { ok: false, reason: "error" };
  }
}
