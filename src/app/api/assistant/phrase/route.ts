import { phrase, phraseInput } from "@/modules/assistant/api/phrase";

export const maxDuration = 30;

export async function POST(request: Request) {
  const parsed = phraseInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "No instructions were sent." }, { status: 400 });
  return Response.json(await phrase(parsed.data));
}
