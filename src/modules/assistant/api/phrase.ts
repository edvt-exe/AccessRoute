import { z } from "zod";
import { callClaudeJson, hasClaude } from "@/core/ai/claude";

export const phraseInput = z.object({
  sentences: z.array(z.string().max(400)).min(1).max(30),
  destination: z.string().max(80),
});

const answerSchema = z.object({ sentences: z.array(z.string()) });

const system = `You are an orientation and mobility instructor guiding a blind colleague through an office, one short
instruction at a time. You get the instructions an app made from the map. Rewrite each one the way a good instructor
would say it: calm, short, concrete, using the wall, corners and doors as the person feels them with the cane.
Rules, a wrong word can hurt someone:
- keep every fact: every number, every left and right, every turn, every name of a place or object, every warning
- add no fact, no place, no number and no direction that is not in the instruction
- at most two short sentences each, no more than 30 words
- keep the order, one rewritten instruction for each one you get
Answer only with the json.`;

// keeps an instruction only when every number and every left or right of the original is still there
export function keepsFacts(original: string, rewritten: string) {
  const numbers = (s: string) => (s.match(/\d+(?:[.,]\d+)?/g) ?? []).sort().join(" ");
  const count = (s: string, word: RegExp) => (s.toLowerCase().match(word) ?? []).length;
  if (numbers(original) !== numbers(rewritten)) return false;
  for (const word of [/\bleft\b/g, /\bright\b/g, /\baround\b/g, /\bcareful\b/g, /\bstairs?\b|\bsteps? down\b/g, /\bglass\b/g, /\bhead\b/g]) {
    if (count(original, word) > 0 && count(rewritten, word) === 0) return false;
  }
  // a turn may not change side
  if (count(original, /\bleft\b/g) === 0 && count(rewritten, /\bleft\b/g) > 0) return false;
  if (count(original, /\bright\b/g) === 0 && count(rewritten, /\bright\b/g) > 0) return false;
  return rewritten.trim().length > 0 && rewritten.length <= original.length * 1.8 + 60;
}

// the ai only words the instructions, the facts all come from the map. anything it changed is dropped
export async function phrase(input: z.infer<typeof phraseInput>): Promise<{ sentences: (string | null)[] }> {
  if (!hasClaude()) return { sentences: input.sentences.map(() => null) };
  try {
    const answer = await callClaudeJson(answerSchema, {
      task: `phrase ${input.sentences.length} instructions`,
      system,
      prompt: `The person is going to ${input.destination}. Instructions:\n${input.sentences.map((s, i) => `${i + 1}. ${s}`).join("\n")}`,
      maxTokens: 1200,
    });
    return { sentences: input.sentences.map((s, i) => (answer.sentences[i] && keepsFacts(s, answer.sentences[i]) ? answer.sentences[i].trim() : null)) };
  } catch (error) {
    console.error("[ai] phrase failed", error);
    return { sentences: input.sentences.map(() => null) };
  }
}
