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

  const message = await getClient().messages.parse({
    model: visionModel,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content }],
    output_config: { format: zodOutputFormat(schema) },
  });

  const { input_tokens, output_tokens } = message.usage;
  const cost = (input_tokens * inputPrice + output_tokens * outputPrice) / 1_000_000;
  console.info(`[ai] ${task}: ${input_tokens} in, ${output_tokens} out, ~$${cost.toFixed(4)}`);

  if (message.parsed_output == null) throw new Error("the ai returned no structured output");
  return message.parsed_output as z.infer<T>;
}
