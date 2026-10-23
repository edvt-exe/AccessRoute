"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { useStaffName } from "@/core/device/store";
import type { FloorMap } from "@/core/map";
import { useJson } from "@/core/storage/client";
import { LinkButton, Notice } from "@/core/ui";
import { ObstacleEditor, useObstacles } from "@/modules/reports";
import { saveMap } from "@/modules/review";

export function ObstaclesScreen() {
  const { id } = useParams<{ id: string }>();
  const result = useJson<FloorMap>(`/api/maps?id=${encodeURIComponent(id)}`);
  const [changed, setChanged] = useState<FloorMap | null>(null);
  const obstacles = useObstacles(4000);
  const name = useStaffName();
  const map = changed ?? (result.status === "ready" ? result.data : null);

  return (
    <>
      <h1 className="text-3xl font-black">Obstacles</h1>
      <p className="text-lg">
        Something in the way, like a wet floor or boxes, changes the routes of guided colleagues straight away. Temporary
        obstacles disappear by themselves when their time is up.
      </p>
      {result.status === "loading" && <p className="text-lg">Loading…</p>}
      {result.status === "error" && <Notice tone="error">{result.error}</Notice>}
      {map && (
        <ObstacleEditor
          map={map}
          obstacles={obstacles}
          staffName={name ?? ""}
          onAddPermanent={async (spot) => setChanged(await saveMap({ ...map, spots: [...map.spots, spot] }))}
        />
      )}
      <LinkButton href="/staff" variant="secondary">
        Back
      </LinkButton>
    </>
  );
}
