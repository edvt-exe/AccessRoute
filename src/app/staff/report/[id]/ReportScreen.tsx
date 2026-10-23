"use client";

import { useParams } from "next/navigation";
import { useStaffName } from "@/core/device/store";
import type { FloorMap } from "@/core/map";
import { useJson } from "@/core/storage/client";
import { LinkButton, Notice } from "@/core/ui";
import { ProblemReport, useProblems } from "@/modules/reports";

export function ReportScreen() {
  const { id } = useParams<{ id: string }>();
  const result = useJson<FloorMap>(`/api/maps?id=${encodeURIComponent(id)}`);
  const problems = useProblems(4000);
  const name = useStaffName();

  return (
    <>
      <h1 className="text-3xl font-black">Report a problem</h1>
      <p className="text-lg">A broken lift or a blocked door changes the route for every guided colleague within seconds.</p>
      {result.status === "loading" && <p className="text-lg">Loading…</p>}
      {result.status === "error" && <Notice tone="error">{result.error}</Notice>}
      {result.status === "ready" && <ProblemReport map={result.data} problems={problems} staffName={name ?? ""} />}
      <LinkButton href="/staff" variant="secondary">
        Back
      </LinkButton>
    </>
  );
}
