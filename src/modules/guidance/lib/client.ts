"use client";

import { requestJson } from "@/core/storage/client";
import type { LocateResult } from "../api/locate";

export function locateOnMap(mapId: string, frames: string[]) {
  return requestJson<LocateResult>("/api/locate", { method: "POST", body: JSON.stringify({ mapId, frames }) }).catch(
    (): LocateResult => ({ ok: false, reason: "error" }),
  );
}
