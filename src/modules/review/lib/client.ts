"use client";

import type { FloorMap } from "@/core/map";
import { requestJson } from "@/core/storage/client";

export function saveMap(map: FloorMap) {
  return requestJson<FloorMap>("/api/maps", { method: "PUT", body: JSON.stringify(map) });
}

export function deleteMap(id: string) {
  return requestJson<{ ok: true }>(`/api/maps?id=${encodeURIComponent(id)}`, { method: "DELETE" });
}
