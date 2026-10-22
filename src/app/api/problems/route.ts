import { connection } from "next/server";
import { getProblems, reportInput, reportProblem, resolveInput, resolveProblem } from "@/modules/reports/api/problems";

export async function GET() {
  await connection();
  return Response.json(await getProblems());
}

export async function POST(request: Request) {
  const parsed = reportInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Choose a place and a reason." }, { status: 400 });
  return Response.json(await reportProblem(parsed.data), { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = resolveInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Unknown problem." }, { status: 400 });
  return Response.json(await resolveProblem(parsed.data.id));
}
