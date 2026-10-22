import { connection } from "next/server";
import { addRequest, doneInput, getRequests, markRequestDone, requestInput } from "@/modules/reports/api/requests";

export async function GET() {
  await connection();
  return Response.json(await getRequests());
}

export async function POST(request: Request) {
  const parsed = requestInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "The request is not valid." }, { status: 400 });
  return Response.json(await addRequest(parsed.data.note), { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = doneInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Unknown request." }, { status: 400 });
  return Response.json(await markRequestDone(parsed.data.id));
}
