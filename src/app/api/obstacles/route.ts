import { connection } from "next/server";
import { addObstacle, getObstacles, obstacleInput, removeInput, removeObstacle } from "@/modules/reports/api/obstacles";

export async function GET() {
  await connection();
  return Response.json(await getObstacles());
}

export async function POST(request: Request) {
  const parsed = obstacleInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Tap the map where it is and give it a name." }, { status: 400 });
  return Response.json(await addObstacle(parsed.data), { status: 201 });
}

export async function PATCH(request: Request) {
  const parsed = removeInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Unknown obstacle." }, { status: 400 });
  return Response.json(await removeObstacle(parsed.data.id));
}
