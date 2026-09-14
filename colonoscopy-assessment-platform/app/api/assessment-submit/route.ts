import { assessmentDatabase, AssessmentDatabaseError, isPostgresConfigured } from "../../../lib/server/postgres.ts";
import type { VideoSubmission } from "../../../lib/assessmentTypes.ts";
import {
  readAssessmentAccessCookie,
  verifyAssessmentAccessToken
} from "../../../lib/assessmentAccessToken.ts";
import { buildSubmissionRpcParams } from "../../../lib/lesionResponse.ts";

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

  try {
    const params = buildSubmissionRpcParams({
      ...submission, participant_id: participantId, session_number: sessionNumber
    });
    await assessmentDatabase.submit(params);
    return json({ saved: true }, 200);
  } catch (error) {
    return json({ error: error instanceof AssessmentDatabaseError ? error.message : "Invalid response submission." },
      error instanceof AssessmentDatabaseError ? error.status : 400);
  }
}
