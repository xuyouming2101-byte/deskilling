import AssessmentClient from "@/components/AssessmentClient";
import { readDeploymentMode } from "@/lib/runtime/deploymentMode";

export const dynamic = "force-dynamic";

export default function Home() {
  const deploymentMode = readDeploymentMode();

  return <AssessmentClient deploymentMode={deploymentMode} />;
}
