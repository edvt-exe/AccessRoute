import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import type { z } from "zod";

export const visionModel = "claude-sonnet-5-5";

// usd per million tokens for claude-sonnet-5-5, used only to log the cost of each call
const inputPrice = 2;
const outputPrice = 10;

let client: Anthropic | null = null;

export function hasClaude() {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

function getClient() {
  client ??= new Anthropic();
  return client;
}

export type ImageInput = { dataUrl: string; label?: string }; // data url or https url

type JsonCallOptions = {
  task: string; // shown in the cost log
  system: string;
  prompt: string;
  images?: ImageInput[];
  maxTokens?: number;
};

function imageBlock(source: string): Anthropic.ImageBlockParam | null {
  if (source.startsWith("https://")) return { type: "image", source: { type: "url", url: source } };
  const match = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/.exec(source);
  if (!match) return null;
  return {
    type: "image",
    source: { type: "base64", media_type: match[1] as "image/jpeg" | "image/png" | "image/webp", data: match[2] },
  };
}

export async function callClaudeJson<T extends z.ZodType>(
  schema: T,
  { task, system, prompt, images = [], maxTokens = 2000 }: JsonCallOptions,
): Promise<z.infer<T>> {
  const content: Anthropic.ContentBlockParam[] = [];
  for (const image of images) {
    const block = imageBlock(image.dataUrl);
    if (!block) continue;
    if (image.label) content.push({ type: "text", text: image.label });
    content.push(block);
  }
  content.push({ type: "text", text: prompt });

  const request = (limit: number) =>
    getClient().messages.parse({
      model: visionModel,
      max_tokens: limit,
      system,
      messages: [{ role: "user", content }],
      output_config: { format: zodOutputFormat(schema) },
    });
  const logCost = (usage: { input_tokens: number; output_tokens: number }) => {
    const cost = (usage.input_tokens * inputPrice + usage.output_tokens * outputPrice) / 1_000_000;
    console.info(`[ai] ${task}: ${usage.input_tokens} in, ${usage.output_tokens} out, ~$${cost.toFixed(4)}`);
  };

  // now and then the json comes back broken or cut off at the token limit; one more try with more room
  // is cheaper than a failed search
  let message = await request(maxTokens).catch((error: Error) => {
    if (!/parse structured output/i.test(error.message)) throw error;
    return null;
  });
  if (message) logCost(message.usage);
  if (!message || message.parsed_output == null) {
    console.warn(`[ai] ${task}: ${message?.stop_reason === "max_tokens" || !message ? "answer cut off or broken" : "no answer"}, trying once more`);
    message = await request(maxTokens * 2);
    logCost(message.usage);
  }

  if (message.parsed_output == null) throw new Error("the ai returned no structured output");
  return message.parsed_output as z.infer<T>;
}
