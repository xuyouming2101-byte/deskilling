import AssessmentClient from "@/components/AssessmentClient";
import { readDeploymentMode } from "@/lib/runtime/deploymentMode";
import { readDevDiagnosticsGate } from "@/lib/runtime/devDiagnostics";

export const dynamic = "force-dynamic";

export default async function Home() {
  const deploymentMode = readDeploymentMode();
  const devDiagnosticsEnabled = await readDevDiagnosticsGate(deploymentMode);

  return (
    <AssessmentClient
      deploymentMode={deploymentMode}
      devDiagnosticsEnabled={devDiagnosticsEnabled}
    />
  );
}
