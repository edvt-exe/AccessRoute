"use client";

import { useRouter } from "next/navigation";
import { useStaffName } from "@/core/device/store";
import { LinkButton } from "@/core/ui";
import { Recorder } from "@/modules/recording";

export function RecordScreen() {
  const router = useRouter();
  const name = useStaffName();
  if (name === undefined) return <p className="text-lg">Loading…</p>;

  return (
    <>
      <h1 className="text-3xl font-black">Record a floor</h1>
      <Recorder staffName={name ?? ""} onCreated={(map) => router.push(`/staff/review/${map.id}`)} />
      <LinkButton href="/staff" variant="secondary">
        Back
      </LinkButton>
    </>
  );
}
