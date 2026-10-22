import { z } from "zod";
import { floorMapSchema, viewsSchema, type FloorMap, type View } from "@/core/map";
import { loadMap, saveMap, saveViews } from "@/core/storage/maps";

export const createInput = z.object({ map: floorMapSchema, views: viewsSchema.default([]) });

export async function createMap(map: FloorMap, views: View[]) {
  // the phone may retry after a timeout although the first attempt went through
  const existing = await loadMap(map.id);
  if (existing) return existing;
  const now = new Date().toISOString();
  await saveViews(map.id, views);
  return saveMap({ ...map, status: "review", createdAt: now, updatedAt: now, version: 1 });
}
