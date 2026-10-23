import { floorMapSchema, mapIdSchema, type FloorMap, type View } from "@/core/map";
import { deleteMap, listMaps, loadMap, loadPublishedMaps, saveMap, syncDoors } from "@/core/storage/maps";
import { createInput, createMap } from "@/modules/recording/api/create";

export const maxDuration = 60;

function bad(message: string, status = 400) {
  return Response.json({ error: message }, { status });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id");
  if (id) {
    if (!mapIdSchema.safeParse(id).success) return bad("Unknown map");
    const map = await loadMap(id);
    if (!map) return bad("This map does not exist.", 404);
    return Response.json(map);
  }
  if (params.get("published") === "1") return Response.json(await loadPublishedMaps());
  return Response.json(await listMaps());
}

export async function POST(request: Request) {
  const parsed = createInput.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "The recording is not valid.");
  try {
    const created = await createMap(parsed.data.map as FloorMap, parsed.data.views as View[]);
    return Response.json(created, { status: 201 });
  } catch (error) {
    return bad((error as Error).message, 409);
  }
}

export async function PUT(request: Request) {
  const parsed = floorMapSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return bad(parsed.error.issues[0]?.message ?? "The map is not valid.");
  const existing = await loadMap(parsed.data.id);
  if (!existing) return bad("This map does not exist.", 404);
  const next: FloorMap = {
    ...(parsed.data as FloorMap),
    createdAt: existing.createdAt,
    createdBy: existing.createdBy,
    videoUrl: existing.videoUrl,
    version: existing.version + 1,
    updatedAt: new Date().toISOString(),
  };
  const saved = await saveMap(next);
  await syncDoors(existing, saved);
  return Response.json(saved);
}

export async function DELETE(request: Request) {
  const id = new URL(request.url).searchParams.get("id");
  if (!id || !mapIdSchema.safeParse(id).success) return bad("Unknown map");
  await deleteMap(id);
  return Response.json({ ok: true });
}
