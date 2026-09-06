import type { VideoSubmission } from "../../../lib/assessmentTypes.ts";
import {
  readAssessmentAccessCookie,
  verifyAssessmentAccessToken
} from "../../../lib/assessmentAccessToken.ts";
import { buildSubmissionRpcParams } from "../../../lib/lesionResponse.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SUBMIT_RESPONSE_RPC = "submit_video_response";

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store"
    }
  });
}

function rpcErrorMessage(value: unknown) {
  if (
    typeof value === "object" &&
    value !== null &&
    "message" in value &&
    typeof value.message === "string" &&
    value.message
  ) {
    return value.message;
  }

  return "Unable to save response.";
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const signingSecret = process.env.FORMAL_VIDEO_SIGNING_SECRET;

  if (!supabaseUrl || !serviceRoleKey || !signingSecret) {
    return json({ error: "Assessment service is not configured." }, 500);
  }

  let submission: VideoSubmission;
  try {
    submission = (await request.json()) as VideoSubmission;
  } catch {
    return json({ error: "Assessment access denied." }, 403);
  }

  const participantId =
    typeof submission?.participant_id === "string"
      ? submission.participant_id.trim().toUpperCase()
      : "";
  const sessionNumber = Number(submission?.session_number);

  if (
    !participantId ||
    !Number.isInteger(sessionNumber) ||
    sessionNumber < 1 ||
    sessionNumber > 3
  ) {
    return json({ error: "Assessment access denied." }, 403);
  }

  const token = readAssessmentAccessCookie(request.headers.get("cookie"));
  const authorized =
    token !== null &&
    verifyAssessmentAccessToken({
      token,
      participantId,
      sessionNumber,
      secret: signingSecret,
      nowSeconds: Math.floor(Date.now() / 1000)
    });

  if (!authorized) {
    return json({ error: "Assessment access denied." }, 403);
  }

  let response: Response;
  try {
    response = await fetch(
      `${supabaseUrl}/rest/v1/rpc/${SUBMIT_RESPONSE_RPC}`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify(
          buildSubmissionRpcParams({
            ...submission,
            participant_id: participantId,
            session_number: sessionNumber
          })
        ),
        cache: "no-store"
      }
    );
  } catch {
    return json({ error: "Unable to reach assessment database." }, 503);
  }

  let result: unknown = null;
  if (response.status !== 204) {
    try {
      result = await response.json();
    } catch {
      result = null;
    }
  }

  if (!response.ok) {
    return json({ error: rpcErrorMessage(result) }, 400);
  }

  return json({ saved: true }, 200);
}
