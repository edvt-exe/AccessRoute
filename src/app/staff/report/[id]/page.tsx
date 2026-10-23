import { Suspense } from "react";
import { ReportScreen } from "./ReportScreen";

export default function ReportPage() {
  return (
    <Suspense fallback={<p className="text-lg">Loading…</p>}>
      <ReportScreen />
    </Suspense>
  );
}
