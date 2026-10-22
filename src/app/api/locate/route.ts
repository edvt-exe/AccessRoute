import { locate, locateInput } from "@/modules/guidance/api/locate";

export const maxDuration = 30;

export async function POST(request: Request) {
  const parsed = locateInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "No photo was sent." }, { status: 400 });
  return Response.json(await locate(parsed.data));
}
