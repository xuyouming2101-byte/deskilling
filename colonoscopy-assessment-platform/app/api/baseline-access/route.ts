import { assessmentDatabase, isPostgresConfigured } from "../../../lib/server/postgres.ts";
import { buildAssessmentAccessSetCookie, createAssessmentAccessToken } from "../../../lib/assessmentAccessToken.ts";

export const dynamic = "force-dynamic";

function json(body: object, status: number, cookie?: string) {
  return Response.json(body, { status, headers: {
    "Cache-Control": "private, no-store",
    ...(cookie ? { "Set-Cookie": cookie } : {})
  } });
}

export async function POST(request: Request) {
  if (process.env.ASSESSMENT_DEPLOYMENT_MODE === "local") {
    return json({ error: "Baseline entry is unavailable." }, 404);
  }
  const secret = process.env.FORMAL_VIDEO_SIGNING_SECRET;
  if (!secret || !isPostgresConfigured()) {
    return json({ error: "Baseline entry is not configured." }, 500);
  }
  const body: unknown = await request.json().catch(() => null);
  // No client-selected session, condition or alternate participant aliases.
  if (!body || typeof body !== "object" || Array.isArray(body) ||
      Object.keys(body).length !== 1 || !("participant_id" in body) ||
      typeof body.participant_id !== "string" || !/^P(2[1-9]|3[0-9]|40)$/.test(body.participant_id)) {
    return json({ error: "This Participant ID is not eligible for this entry." }, 403);
  }
  try {
    const rows = await assessmentDatabase.claim(body.participant_id, 1);
    if (rows.length !== 1 || rows[0]?.is_open !== true) {
      return json({ error: "This session is not yet available." }, 403);
    }
  } catch {
    return json({ error: "Unable to verify session availability. Please try again." }, 503);
  }
  const token = createAssessmentAccessToken({ participantId: body.participant_id,
    sessionNumber: 1, secret, nowSeconds: Math.floor(Date.now() / 1000) });
  return json({ authorized: true }, 200, buildAssessmentAccessSetCookie(token));
}
