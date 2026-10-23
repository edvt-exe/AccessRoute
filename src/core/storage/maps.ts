import { changesFloor, floorMapSchema, otherEnd, viewsSchema, type DoorRef, type FloorMap, type MapSummary, type View } from "@/core/map";
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
      places: m.spots.filter((s) => s.kind === "place").map((s) => ({ id: s.id, name: s.name, door: Boolean(s.door), via: s.via ?? null })),
    }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function loadPublishedMaps() {
  const summaries = (await listMaps()).filter((m) => m.status === "published");
  const maps = await Promise.all(summaries.map((m) => loadMap(m.id)));
  return maps.filter((m): m is FloorMap => m !== null);
}

const refKey = (ref: DoorRef | null | undefined) => (ref ? `${ref.mapId}/${ref.spotId}` : "");

// a door is set from one room in the review; the other side of it is updated to point back,
// and a side that pointed here before is let go
export async function syncDoors(before: FloorMap | null, after: FloorMap) {
  const others = new Map<string, FloorMap>();
  const open = async (id: string) => others.get(id) ?? (await loadMap(id));
  const keep = (map: FloorMap) => others.set(map.id, map);

  async function unlink(ref: DoorRef, from: string) {
    const map = await open(ref.mapId);
    const spot = map?.spots.find((s) => s.id === ref.spotId);
    if (!map || !spot || refKey(spot.leadsTo) !== from) return;
    spot.leadsTo = null;
    keep(map);
  }

  const old = new Map((before?.spots ?? []).map((s) => [s.id, s.door ? (s.leadsTo ?? null) : null]));
  const ids = new Set([...old.keys(), ...after.spots.map((s) => s.id)]);
  for (const id of ids) {
    const spot = after.spots.find((s) => s.id === id);
    const previous = old.get(id) ?? null;
    const now = spot?.door ? (spot.leadsTo ?? null) : null;
    if (refKey(previous) === refKey(now)) continue;
    const here = refKey({ mapId: after.id, spotId: id });
    if (previous && previous.mapId !== after.id) await unlink(previous, here);
    if (!now || now.mapId === after.id) continue;
    const map = await open(now.mapId);
    const target = map?.spots.find((s) => s.id === now.spotId);
    if (!map || !target) continue;
    // the other side may have been joined to a third door, that one is let go first
    if (target.leadsTo && refKey(target.leadsTo) !== here) await unlink(target.leadsTo, refKey(now));
    target.door = true;
    target.leadsTo = { mapId: after.id, spotId: id };
    // a lift is a lift on both floors; the other end of stairs goes the other way
    if (spot && changesFloor(spot) && !changesFloor(target)) {
      target.via = spot.via;
      if (spot.stairs) target.stairs = otherEnd(spot.stairs);
    }
    keep(map);
  }
  for (const map of others.values()) {
    if (map.id !== after.id) await saveMap({ ...map, updatedAt: new Date().toISOString() });
  }
}
