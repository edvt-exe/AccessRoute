import { Suspense } from "react";
import { ObstaclesScreen } from "./ObstaclesScreen";

export default function ObstaclesPage() {
  return (
    <Suspense fallback={<p className="text-lg">Loading…</p>}>
      <ObstaclesScreen />
    </Suspense>
  );
}
