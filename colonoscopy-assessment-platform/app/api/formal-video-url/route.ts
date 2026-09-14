import { readAssessmentAccessCookie, verifyAssessmentAccessToken } from "../../../lib/assessmentAccessToken.ts";
import { assessmentDatabase, AssessmentDatabaseError, isPostgresConfigured } from "../../../lib/server/postgres.ts";
import {
  createFormalVideoSignature,
  isAllowedFormalVideoPath
} from "../../../lib/formalVideoAuth.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const SIGNED_URL_EXPIRY_SECONDS = 6 * 60 * 60;
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
  const signingSecret = process.env.FORMAL_VIDEO_SIGNING_SECRET;

  if (!isPostgresConfigured() || !signingSecret) {
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
      ? body.participant_id.trim().toUpperCase()
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

  const token = readAssessmentAccessCookie(request.headers.get("cookie"));
  if (!token || !verifyAssessmentAccessToken({
    token, participantId, sessionNumber, secret: signingSecret,
    nowSeconds: Math.floor(Date.now() / 1000)
  })) return json({ error: "Video access denied." }, 403);

  let rows: unknown;
  try {
    rows = await assessmentDatabase.authorize(participantId, sessionNumber, videoOrder);
  } catch (error) {
    const status = error instanceof AssessmentDatabaseError && error.status !== 400 ? error.status : 403;
    return json({ error: status === 403 ? "Video access denied." : "Unable to reach assessment database." }, status);
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
