import { ask, askInput } from "@/modules/assistant/api/ask";

export const maxDuration = 30;

export async function POST(request: Request) {
  const parsed = askInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Nothing was said." }, { status: 400 });
  return Response.json(await ask(parsed.data));
}
