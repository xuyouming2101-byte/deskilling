import "server-only";

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

export async function POST(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    if (readDeploymentMode() !== "local") {
      return jsonError(
        "LOCAL_ABANDON_ROUTE_DISABLED",
        "The LOCAL abandon route is disabled in this deployment.",
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

  try {
    const body = await request.json();

    if (
      typeof body !== "object" ||
      body === null ||
      Array.isArray(body) ||
      Object.keys(body).length !== 0
    ) {
      return jsonError(
        "LOCAL_ABANDON_REQUEST_INVALID",
        "The abandon request must contain an empty JSON object.",
        400
      );
    }

    const { attemptId } = await context.params;
    await withLocalAssessmentRepository(false, (repository) =>
      repository.markAttemptAbandoned(attemptId)
    );
    return new Response(null, { status: 204 });
  } catch (error) {
    return jsonError(
      "LOCAL_ABANDON_FAILED",
      error instanceof Error ? error.message : "LOCAL abandon failed.",
      409
    );
  }
}
