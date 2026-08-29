import AssessmentClient from "@/components/AssessmentClient";
import { readDeploymentMode } from "@/lib/runtime/deploymentMode";

export const dynamic = "force-dynamic";

export default function Home() {
  const deploymentMode = readDeploymentMode();

  if (deploymentMode === "online") {
    return <AssessmentClient />;
  }

  return (
    <main>
      <h1>LOCAL assessment is not configured</h1>
      <p>The LOCAL assessment repository will be connected in the next phase.</p>
    </main>
  );
}
