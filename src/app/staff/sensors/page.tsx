import { LinkButton } from "@/core/ui";
import { SensorLab } from "@/modules/diagnostics";

export default function SensorsPage() {
  return (
    <>
      <h1 className="text-3xl font-black">Test the motion sensors</h1>
      <SensorLab />
      <LinkButton href="/staff" variant="secondary">
        Back
      </LinkButton>
    </>
  );
}
