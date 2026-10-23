import { Suspense } from "react";
import { ReviewScreen } from "./ReviewScreen";

export default function ReviewPage() {
  return (
    <Suspense fallback={<p className="text-lg">Loading…</p>}>
      <ReviewScreen />
    </Suspense>
  );
}
