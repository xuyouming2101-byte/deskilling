import { notFound } from "next/navigation";
import AssessmentUiParityHarness from "@/components/AssessmentUiParityHarness";

export const dynamic = "force-dynamic";

export default async function AssessmentUiParityPage({
  searchParams
}: {
  searchParams: Promise<{ variant?: string }>;
}) {
  if (process.env.ASSESSMENT_UI_PARITY_FIXTURE !== "1") {
    notFound();
  }

  const { variant } = await searchParams;

  if (variant !== "local" && variant !== "online") {
    notFound();
  }

  return <AssessmentUiParityHarness deploymentMode={variant} />;
}
