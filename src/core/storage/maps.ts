import { floorMapSchema, viewsSchema, type FloorMap, type MapSummary, type View } from "@/core/map";
import { listJson, readJson, writeJson } from "./blob";

const file = (id: string) => `maps/${id}.json`;

// files from older versions or half written files are skipped instead of crashing the app
function isMap(value: unknown): value is FloorMap {
  const map = value as Partial<FloorMap> | null;
  return Boolean(
    map &&
      typeof map.id === "string" &&
      typeof map.name === "string" &&
      (map.status === "review" || map.status === "published") &&
      Array.isArray(map.outline) &&
      Array.isArray(map.spots) &&
      map.spots.length > 0,
  );
}

export async function loadMap(id: string) {
  const map = await readJson<unknown>(file(id));
  return isMap(map) ? map : null;
}

export async function saveMap(map: FloorMap) {
  const parsed = floorMapSchema.parse(map) as FloorMap;
  await writeJson(file(parsed.id), parsed);
  return parsed;
}

export async function deleteMap(id: string) {
  // overwriting with a marker works the same on local disk and blob, isMap skips it
  await writeJson(file(id), { deleted: true });
  await writeJson(viewsFile(id), []);
}

// the automatic photos are only needed by the server for camera recognition, so they live in their own
// file and the phones never download them
const viewsFile = (id: string) => `views/${id}.json`;

export async function saveViews(id: string, views: View[]) {
  await writeJson(viewsFile(id), viewsSchema.parse(views));
}

export async function loadViews(id: string): Promise<View[]> {
  const parsed = viewsSchema.safeParse(await readJson<unknown>(viewsFile(id)));
  return parsed.success ? (parsed.data as View[]) : [];
}

export async function listMaps(): Promise<MapSummary[]> {
  const paths = await listJson("maps/");
  const maps = await Promise.all(paths.map((p) => readJson<unknown>(p)));
  return maps
    .filter(isMap)
    .map((m) => ({
      id: m.id,
      name: m.name,
      status: m.status,
      createdBy: m.createdBy,
      createdAt: m.createdAt,
      updatedAt: m.updatedAt,
      placeCount: m.spots.filter((s) => s.kind === "place").length,
      obstacleCount: m.spots.filter((s) => s.kind === "obstacle").length,
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadPublishedMaps() {
  const summaries = (await listMaps()).filter((m) => m.status === "published");
  const maps = await Promise.all(summaries.map((m) => loadMap(m.id)));
  return maps.filter((m): m is FloorMap => m !== null);
}
