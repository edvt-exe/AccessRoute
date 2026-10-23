"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { saveRole, saveTutorialDone, useTutorialDone } from "@/core/device/store";
import type { FloorMap } from "@/core/map";
import { useJson } from "@/core/storage/client";
import { Notice } from "@/core/ui";
import { GuideApp, Tutorial, type Blocked } from "@/modules/guidance";
import { fetchObstacles, fetchProblems, obstacleSpot, requestRecording } from "@/modules/reports";

async function blockedOn(mapId: string): Promise<Blocked> {
  const [all, temporary] = await Promise.all([fetchProblems(), fetchObstacles().catch(() => [])]);
  const problems = all.filter((p) => p.mapId === mapId && !p.resolved);
  return {
    ids: problems.map((p) => p.placeId),
    reasons: Object.fromEntries(problems.map((p) => [p.placeId, p.reason.toLowerCase()])),
    obstacles: temporary.filter((o) => o.mapId === mapId).map(obstacleSpot),
  };
}

export function GuideScreen() {
  // staff open ?map=<id> to test a map before publishing it
  const testMap = useSearchParams().get("map");
  const url = testMap ? `/api/maps?id=${encodeURIComponent(testMap)}` : "/api/maps?published=1";
  const result = useJson<FloorMap | FloorMap[]>(url);
  const tutorialDone = useTutorialDone();
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (!testMap) saveRole("guided");
  }, [testMap]);

  if (result.status === "loading" || tutorialDone === undefined) return <p className="text-2xl">Loading…</p>;
  if (result.status === "error") return <Notice tone="error">Could not load the building map: {result.error}</Notice>;

  const maps = Array.isArray(result.data) ? result.data : [result.data];
  // the first time, and whenever help is asked for; staff testing a map skip it
  if (helpOpen || (!tutorialDone && !testMap)) {
    return (
      <>
        <h1 className="sr-only">AccessRoute tutorial</h1>
        <Tutorial
          places={maps.flatMap((m) => m.spots.filter((s) => s.kind === "place"))}
          onDone={() => {
            saveTutorialDone(true);
            setHelpOpen(false);
          }}
        />
      </>
    );
  }
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
        onHelp={() => setHelpOpen(true)}
      />
    </>
  );
}
