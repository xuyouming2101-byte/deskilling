import "server-only";

import { handleLocalResponse } from "../../local/attempts/[attemptId]/responses/route.ts";
import { readDeploymentMode } from "../../../../lib/runtime/deploymentMode.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

  if (mode === "local") {
    return handleLocalResponse(request);
  }

  return Response.json(
    {
      code: "ONLINE_RESPONSE_ADAPTER_UNAVAILABLE",
      message: "The ONLINE response adapter is not implemented."
    },
    { status: 501 }
  );
}
