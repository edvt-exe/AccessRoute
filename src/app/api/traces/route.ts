import { saveTrace, traceInput } from "@/modules/diagnostics/api/traces";

export async function POST(request: Request) {
  const parsed = traceInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "The recording is not valid." }, { status: 400 });
  return Response.json(await saveTrace(parsed.data), { status: 201 });
}
