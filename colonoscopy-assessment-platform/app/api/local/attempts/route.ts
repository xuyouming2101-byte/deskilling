import "server-only";

import { parseParticipantStartInput } from "../../../../lib/assessment/contracts.ts";
import { withLocalAssessmentRepository } from "../../../../lib/local/localRuntime.ts";
import { readDeploymentMode } from "../../../../lib/runtime/deploymentMode.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ code, message }, { status });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new Error("Request body must be valid JSON.");
  }
}

export async function handleLocalAttemptStart(
  request: Request
): Promise<Response> {
  try {
    if (readDeploymentMode() !== "local") {
      return jsonError(
        "LOCAL_ATTEMPT_ROUTE_DISABLED",
        "The LOCAL attempt route is disabled in this deployment.",
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

  let input;

  try {
    input = parseParticipantStartInput(await readJson(request));
  } catch (error) {
    return jsonError(
      "LOCAL_START_REQUEST_INVALID",
      error instanceof Error ? error.message : "The start request is invalid.",
      400
    );
  }

  try {
    const result = await withLocalAssessmentRepository(
      true,
      (repository) => repository.createOrResumeAttempt(input)
    );
    return Response.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : "LOCAL start failed.";
    const status = /roster|does not match participant/i.test(message) ? 403 : 500;
    return jsonError("LOCAL_START_FAILED", message, status);
  }
}

export const POST = handleLocalAttemptStart;
