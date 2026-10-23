import { lookAhead, lookInput } from "@/modules/assistant/api/look";

export const maxDuration = 30;

export async function POST(request: Request) {
  const parsed = lookInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "No photo was sent." }, { status: 400 });
  return Response.json(await lookAhead(parsed.data));
}
