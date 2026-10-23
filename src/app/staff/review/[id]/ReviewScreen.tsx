"use client";

import { useParams, useRouter } from "next/navigation";
import type { FloorMap } from "@/core/map";
import { useJson } from "@/core/storage/client";
import { LinkButton, Notice } from "@/core/ui";
import { useProblems } from "@/modules/reports";
import { ReviewEditor } from "@/modules/review";

export function ReviewScreen() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const result = useJson<FloorMap>(`/api/maps?id=${encodeURIComponent(id)}`);
  const problems = useProblems(10000);

  return (
    <>
      <h1 className="text-3xl font-black">Check the map</h1>
      {result.status === "loading" && <p className="text-lg">Loading…</p>}
      {result.status === "error" && <Notice tone="error">{result.error}</Notice>}
      {result.status === "ready" && (
        <ReviewEditor
          key={`${result.data.id}-${result.data.version}`}
          initial={result.data}
          blockedIds={problems.filter((p) => p.mapId === id && !p.resolved).map((p) => p.placeId)}
          onDeleted={() => router.push("/staff")}
        />
      )}
      <LinkButton href="/staff" variant="secondary">
        Back
      </LinkButton>
    </>
  );
}
