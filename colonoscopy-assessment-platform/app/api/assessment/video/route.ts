import "server-only";

import { withLocalAssessmentRepository } from "../../../../lib/local/localRuntime.ts";
import { readDeploymentMode } from "../../../../lib/runtime/deploymentMode.ts";
import { LocalVideoAccessGateway } from "../../../../lib/video/localVideoAccessGateway.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VIDEO_REQUEST_KEYS = new Set(["attempt_id", "video_order"]);

function invalidRequest(message: string): Response {
  return Response.json(
    { code: "ASSESSMENT_VIDEO_REQUEST_INVALID", message },
    { status: 400 }
  );
}

export async function POST(request: Request): Promise<Response> {
  let mode;

  try {
    mode = readDeploymentMode();
  } catch {
    return Response.json(
      {
        code: "DEPLOYMENT_MODE_INVALID",
        message: "The server deployment mode is missing or invalid."
      },
      { status: 500 }
    );
  }

  if (mode !== "local") {
    return Response.json(
      {
        code: "ONLINE_VIDEO_ADAPTER_UNAVAILABLE",
        message: "The ONLINE video adapter is not implemented."
      },
      { status: 501 }
    );
  }

  let input: { attemptId: string; videoOrder: number };

  try {
    const body = await request.json();

    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return invalidRequest("The video request must be an object.");
    }

    if (Object.keys(body).some((key) => !VIDEO_REQUEST_KEYS.has(key))) {
      return invalidRequest("The video request contains unsupported fields.");
    }

    const attemptId = (body as Record<string, unknown>).attempt_id;
    const videoOrder = (body as Record<string, unknown>).video_order;

    if (
      typeof attemptId !== "string" ||
      attemptId.trim() !== attemptId ||
      attemptId.length === 0 ||
      !Number.isSafeInteger(videoOrder) ||
      (videoOrder as number) < 1
    ) {
      return invalidRequest("The video request contains invalid values.");
    }

    input = { attemptId, videoOrder: videoOrder as number };
  } catch {
    return invalidRequest("Request body must be valid JSON.");
  }

  try {
    const source = await withLocalAssessmentRepository(false, (repository) =>
      new LocalVideoAccessGateway(repository).getCurrentVideo(input)
    );
    return Response.json(source);
  } catch {
    return Response.json(
      {
        code: "LOCAL_VIDEO_NOT_AUTHORIZED",
        message: "The requested video is not the current authorized video."
      },
      { status: 404 }
    );
  }
}
