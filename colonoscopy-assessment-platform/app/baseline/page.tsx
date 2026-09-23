import AssessmentClient from "@/components/AssessmentClient";
import { notFound } from "next/navigation";

export const dynamic = "force-dynamic";

export default function Baseline() {
  if (process.env.ASSESSMENT_DEPLOYMENT_MODE === "local") notFound();
  return <AssessmentClient requiresOnlinePassword baselineIdOnly />;
}
