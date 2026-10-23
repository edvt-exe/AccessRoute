import { analyseInput, analyseMap } from "@/modules/assistant/api/analyse";

export const maxDuration = 60;

export async function POST(request: Request) {
  const parsed = analyseInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Unknown map." }, { status: 400 });
  return Response.json(await analyseMap(parsed.data));
}
