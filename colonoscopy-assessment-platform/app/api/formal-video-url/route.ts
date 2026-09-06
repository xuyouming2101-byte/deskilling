import {
  createFormalVideoSignature,
  isAllowedFormalVideoPath
} from "../../../lib/formalVideoAuth.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIGNED_URL_EXPIRY_SECONDS = 6 * 60 * 60;
const AUTHORIZATION_RPC = "authorize_current_assessment_video";
const FORMAL_ECS_BUCKET = "FORMAL_ECS";

function json(body: object, status: number) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store"
    }
  });
}

export async function POST(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const signingSecret = process.env.FORMAL_VIDEO_SIGNING_SECRET;

  if (!supabaseUrl || !serviceRoleKey || !signingSecret) {
    return json(
      { error: "Formal video service is not configured." },
      500
    );
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return json({ error: "Video access denied." }, 403);
  }

  const participantId =
    typeof body === "object" &&
    body !== null &&
    "participant_id" in body &&
    typeof body.participant_id === "string"
      ? body.participant_id.trim()
      : "";

  const sessionNumber =
    typeof body === "object" &&
    body !== null &&
    "session_number" in body
      ? Number(body.session_number)
      : NaN;

  const videoOrder =
    typeof body === "object" &&
    body !== null &&
    "video_order" in body
      ? Number(body.video_order)
      : NaN;

  if (
    !participantId ||
    !Number.isInteger(sessionNumber) ||
    sessionNumber < 1 ||
    sessionNumber > 3 ||
    !Number.isInteger(videoOrder) ||
    videoOrder < 1
  ) {
    return json({ error: "Video access denied." }, 403);
  }

  const authorizationResponse = await fetch(
    `${supabaseUrl}/rest/v1/rpc/${AUTHORIZATION_RPC}`,
    {
      method: "POST",
      headers: {
        apikey: serviceRoleKey,
        authorization: `Bearer ${serviceRoleKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        p_participant_id: participantId,
        p_session_number: sessionNumber,
        p_video_order: videoOrder
      })
    }
  );

  if (!authorizationResponse.ok) {
    return json({ error: "Video access denied." }, 403);
  }

  let rows: unknown;

  try {
    rows = await authorizationResponse.json();
  } catch {
    return json({ error: "Video access denied." }, 403);
  }

  if (!Array.isArray(rows) || rows.length !== 1) {
    return json({ error: "Video access denied." }, 403);
  }

  const authorized = rows[0] as {
    bucket?: unknown;
    file_path?: unknown;
  };

  if (
    authorized.bucket !== FORMAL_ECS_BUCKET ||
    typeof authorized.file_path !== "string" ||
    !isAllowedFormalVideoPath(authorized.file_path)
  ) {
    return json({ error: "Video access denied." }, 403);
  }

  const expires =
    Math.floor(Date.now() / 1000) + SIGNED_URL_EXPIRY_SECONDS;

  const signature = createFormalVideoSignature({
    path: authorized.file_path,
    expires,
    secret: signingSecret
  });

  const params = new URLSearchParams({
    path: authorized.file_path,
    expires: String(expires),
    sig: signature
  });

  return json(
    {
      signed_url: `/api/formal-video?${params.toString()}`,
      video_order: videoOrder,
      expires_in_seconds: SIGNED_URL_EXPIRY_SECONDS
    },
    200
  );
}
