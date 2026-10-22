"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect } from "react";
import { saveRole, useRole } from "@/core/device/store";

// stands in for the invitation email: in the real product the link already carries the role
export function RoleChooser() {
  const router = useRouter();
  const reset = useSearchParams().get("reset") === "1";
  const role = useRole();

  useEffect(() => {
    if (reset) {
      saveRole(null);
      return;
    }
    if (role === "staff") router.replace("/staff");
    if (role === "guided") router.replace("/guide");
  }, [role, reset, router]);

  if (role === undefined || (role && !reset)) return <p className="text-lg">Loading…</p>;

  return (
    <>
      <h1 className="text-3xl font-black">AccessRoute</h1>
      <p className="text-lg">Choose how this phone will be used. Normally the invitation link sets this for you.</p>
      <button
        type="button"
        onClick={() => {
          saveRole("guided");
          router.push("/guide");
        }}
        className="min-h-40 rounded-3xl border-4 border-primary bg-primary p-6 text-3xl font-black text-primary-fg"
      >
        I need guidance
      </button>
      <button
        type="button"
        onClick={() => {
          saveRole("staff");
          router.push("/staff");
        }}
        className="min-h-28 rounded-3xl border-4 border-fg p-6 text-2xl font-bold"
      >
        I am a team member
      </button>
    </>
  );
}
