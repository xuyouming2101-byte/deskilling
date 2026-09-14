import { assessmentDatabase, AssessmentDatabaseError, isPostgresConfigured } from "../../../lib/server/postgres.ts";
import {
  readAssessmentAccessCookie,
  verifyAssessmentAccessToken
} from "../../../lib/assessmentAccessToken.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";


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

  try {
    const result = await assessmentDatabase.start(participantId, sessionNumber);
    return json({ data: result }, 200);
  } catch (error) {
    return json({ error: error instanceof AssessmentDatabaseError ? error.message : "Unable to load assessment session." },
      error instanceof AssessmentDatabaseError ? error.status : 503);
  }
}
