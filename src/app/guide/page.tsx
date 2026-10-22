import { Suspense } from "react";
import { GuideScreen } from "./GuideScreen";

export default function GuidePage() {
  return (
    <Suspense fallback={<p className="text-2xl">Loading…</p>}>
      <GuideScreen />
    </Suspense>
  );
}
