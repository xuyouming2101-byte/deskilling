import {
  readAssessmentAccessCookie,
  verifyAssessmentAccessToken
} from "../../../lib/assessmentAccessToken.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const START_OR_RESUME_RPC = "start_or_resume_assessment";

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

  return "Unable to load assessment session.";
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const signingSecret = process.env.FORMAL_VIDEO_SIGNING_SECRET;

  if (!supabaseUrl || !serviceRoleKey || !signingSecret) {
    return json({ error: "Assessment service is not configured." }, 500);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ error: "Assessment access denied." }, 403);
  }

  const participantId =
    typeof body === "object" &&
    body !== null &&
    "participant_id" in body &&
    typeof body.participant_id === "string"
      ? body.participant_id.trim().toUpperCase()
      : "";

  const sessionNumber =
    typeof body === "object" &&
    body !== null &&
    "session_number" in body
      ? Number(body.session_number)
      : NaN;

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
      `${supabaseUrl}/rest/v1/rpc/${START_OR_RESUME_RPC}`,
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          authorization: `Bearer ${serviceRoleKey}`,
          "content-type": "application/json"
        },
        body: JSON.stringify({
          p_participant_id: participantId,
          p_session_number: sessionNumber
        }),
        cache: "no-store"
      }
    );
  } catch {
    return json({ error: "Unable to reach assessment database." }, 503);
  }

  let result: unknown = null;
  try {
    result = await response.json();
  } catch {
    result = null;
  }

  if (!response.ok) {
    return json({ error: rpcErrorMessage(result) }, 400);
  }

  return json({ data: result }, 200);
}
