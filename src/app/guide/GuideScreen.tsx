"use client";

import { useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { saveRole } from "@/core/device/store";
import type { FloorMap } from "@/core/map";
import { useJson } from "@/core/storage/client";
import { Notice } from "@/core/ui";
import { GuideApp, type Blocked } from "@/modules/guidance";
import { fetchProblems, requestRecording } from "@/modules/reports";

async function blockedOn(mapId: string): Promise<Blocked> {
  const problems = (await fetchProblems()).filter((p) => p.mapId === mapId && !p.resolved);
  return {
    ids: problems.map((p) => p.placeId),
    reasons: Object.fromEntries(problems.map((p) => [p.placeId, p.reason.toLowerCase()])),
  };
}

export function GuideScreen() {
  // staff open ?map=<id> to test a map before publishing it
  const testMap = useSearchParams().get("map");
  const url = testMap ? `/api/maps?id=${encodeURIComponent(testMap)}` : "/api/maps?published=1";
  const result = useJson<FloorMap | FloorMap[]>(url);

  useEffect(() => {
    if (!testMap) saveRole("guided");
  }, [testMap]);

  if (result.status === "loading") return <p className="text-2xl">Loading…</p>;
  if (result.status === "error") return <Notice tone="error">Could not load the building map: {result.error}</Notice>;

  const maps = Array.isArray(result.data) ? result.data : [result.data];
  return (
    <>
      <h1 className="sr-only">AccessRoute guidance</h1>
      <GuideApp
        maps={maps}
        testMapName={testMap ? maps[0]?.name : undefined}
        getBlocked={blockedOn}
        onRequestRecording={async (note) => {
          await requestRecording(note);
        }}
      />
    </>
  );
}
