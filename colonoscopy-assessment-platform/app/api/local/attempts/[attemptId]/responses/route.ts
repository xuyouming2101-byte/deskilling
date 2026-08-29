import "server-only";

import { parseAttemptVideoSubmission } from "../../../../../../lib/assessment/contracts.ts";
import { withLocalAssessmentRepository } from "../../../../../../lib/local/localRuntime.ts";
import { readDeploymentMode } from "../../../../../../lib/runtime/deploymentMode.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{ attemptId: string }>;
};

function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ code, message }, { status });
}

export async function handleLocalResponse(
  request: Request,
  context?: RouteContext
): Promise<Response> {
  try {
    if (readDeploymentMode() !== "local") {
      return jsonError(
        "LOCAL_RESPONSE_ROUTE_DISABLED",
        "The LOCAL response route is disabled in this deployment.",
        404
      );
    }
  } catch {
    return jsonError(
      "DEPLOYMENT_MODE_INVALID",
      "The server deployment mode is missing or invalid.",
      500
    );
  }

  let submission;

  try {
    submission = parseAttemptVideoSubmission(await request.json());
    const attemptId = context ? (await context.params).attemptId : submission.attemptId;

    if (attemptId !== submission.attemptId) {
      throw new Error("Route attempt ID does not match the response payload.");
    }
  } catch (error) {
    return jsonError(
      "LOCAL_RESPONSE_REQUEST_INVALID",
      error instanceof Error ? error.message : "The response request is invalid.",
      400
    );
  }

  try {
    const result = await withLocalAssessmentRepository(
      false,
      (repository) => repository.submitResponse(submission)
    );
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "LOCAL response failed.";
    const status = /CONFLICT|not for the current|read-only/i.test(message)
      ? 409
      : 500;
    return jsonError("LOCAL_RESPONSE_FAILED", message, status);
  }
}

export const POST = handleLocalResponse;
