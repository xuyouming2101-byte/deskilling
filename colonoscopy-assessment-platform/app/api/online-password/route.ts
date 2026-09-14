import { assessmentDatabase, AssessmentDatabaseError, isPostgresConfigured } from "../../../lib/server/postgres.ts";
import {
  buildAssessmentAccessSetCookie,
  createAssessmentAccessToken
} from "../../../lib/assessmentAccessToken.ts";
import {
  isStudyParticipantId,
  participantPassword
} from "../../../lib/participantAccess.ts";

export const dynamic = "force-dynamic";

type AccessBody = {
  participant_id?: unknown;
  session_number?: unknown;
  password?: unknown;
};

type ClaimRow = {
  opens_at?: unknown;
  server_now?: unknown;
  is_open?: unknown;
};

function json(
  body: object,
  status: number,
  extraHeaders?: Record<string, string>
) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      ...extraHeaders
    }
  });
}

function authorizedResponse(
  participantId: string,
  sessionNumber: number,
  master: boolean,
  signingSecret: string
) {
  const token = createAssessmentAccessToken({
    participantId,
    sessionNumber,
    secret: signingSecret,
    nowSeconds: Math.floor(Date.now() / 1000)
  });

  return json(
    { authorized: true, master },
    200,
    { "Set-Cookie": buildAssessmentAccessSetCookie(token) }
  );
}

export async function POST(request: Request) {
  if (process.env.ASSESSMENT_DEPLOYMENT_MODE === "local") {
    return json({ error: "Online password is unavailable." }, 404);
  }

  const masterPassword = process.env.STUDY_SHARED_PASSWORD;
  const signingSecret = process.env.FORMAL_VIDEO_SIGNING_SECRET;

  if (!masterPassword || !signingSecret) {
    return json({ error: "Online study access is not configured." }, 500);
  }

  let body: AccessBody;
  try {
    body = (await request.json()) as AccessBody;
  } catch {
    return json({ error: "Incorrect Participant ID or password." }, 401);
  }

  const participantId =
    typeof body.participant_id === "string"
      ? body.participant_id.trim().toUpperCase()
      : "";
  const sessionNumber =
    typeof body.session_number === "number"
      ? body.session_number
      : Number(body.session_number);
  const password =
    typeof body.password === "string" ? body.password : "";

  if (
    !participantId ||
    !Number.isInteger(sessionNumber) ||
    sessionNumber < 1 ||
    sessionNumber > 3 ||
    !password
  ) {
    return json({ error: "Incorrect Participant ID or password." }, 401);
  }

  // Master bypasses participant-password and schedule checks.
  // It intentionally does NOT start/change the participant's Day 0.
  if (password === masterPassword) {
    return authorizedResponse(
      participantId,
      sessionNumber,
      true,
      signingSecret
    );
  }

  if (
    !isStudyParticipantId(participantId) ||
    password !== participantPassword(participantId)
  ) {
    return json({ error: "Incorrect Participant ID or password." }, 401);
  }


  if (!isPostgresConfigured()) {
    return json(
      { error: "Participant schedule service is not configured." },
      500
    );
  }

  let rows: ClaimRow[];
  try {
    rows = await assessmentDatabase.claim(participantId, sessionNumber);
  } catch (error) {
    return json(
      { error: "Unable to verify session availability. Please try again." },
      error instanceof AssessmentDatabaseError && error.status === 500 ? 500 : 503
    );
  }

  const isOpen = rows.length === 1 && rows[0]?.is_open === true;

  if (!isOpen) {
    return json({ error: "This session is not yet available." }, 403);
  }

  return authorizedResponse(
    participantId,
    sessionNumber,
    false,
    signingSecret
  );
}
