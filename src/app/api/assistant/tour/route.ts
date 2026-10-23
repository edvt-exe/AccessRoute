import { connection } from "next/server";
import { z } from "zod";
import { createTour, listTours, removeTour, tourInput } from "@/modules/assistant/api/tour";

export const maxDuration = 60;

export async function GET() {
  await connection();
  return Response.json(await listTours());
}

export async function POST(request: Request) {
  const parsed = tourInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Give the guest's name and choose at least one stop." }, { status: 400 });
  return Response.json(await createTour(parsed.data));
}

export async function DELETE(request: Request) {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Unknown tour." }, { status: 400 });
  return Response.json(await removeTour(parsed.data.id));
}
