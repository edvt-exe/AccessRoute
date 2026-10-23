import { judgeAnswer, quizInput } from "@/modules/assistant/api/tour";

export async function POST(request: Request) {
  const parsed = quizInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "No answer was sent." }, { status: 400 });
  return Response.json(await judgeAnswer(parsed.data));
}
