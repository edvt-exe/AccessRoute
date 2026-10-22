import { connection } from "next/server";
import { hasClaude } from "@/core/ai/claude";
import { useBlob } from "@/core/storage/blob";

export async function GET() {
  await connection();
  return Response.json({ blob: useBlob, ai: hasClaude() });
}
