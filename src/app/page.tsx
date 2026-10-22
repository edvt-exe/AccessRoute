import { Suspense } from "react";
import { RoleChooser } from "./RoleChooser";

export default function Home() {
  return (
    <Suspense>
      <RoleChooser />
    </Suspense>
  );
}
