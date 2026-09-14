import "server-only";
import { Pool, type QueryResultRow } from "pg";
import type { buildSubmissionRpcParams } from "../lesionResponse.ts";

type SubmissionParams = ReturnType<typeof buildSubmissionRpcParams>;
type ClaimRow = { opens_at: Date | null; server_now: Date; is_open: boolean };
type QueueRow = { video_id: string; video_order: number; next_video_order: number; queue_length: number; study_mode: string };
type VideoRow = { bucket: string; file_path: string };

export class AssessmentDatabaseError extends Error {
  readonly status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

let pool: Pool | undefined;
let poolUrl: string | undefined;

export function isPostgresConfigured() {
  return Boolean(process.env.DATABASE_URL);
}

function connectionPool() {
  const connectionString = process.env.DATABASE_URL;
  try {
    if (!connectionString) throw new Error();
    const url = new URL(connectionString);
    if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
        decodeURIComponent(url.username) !== 'deskilling_app' || !url.hostname ||
        !url.password || url.pathname.length < 2 || url.search || url.hash ||
        (poolUrl !== undefined && poolUrl !== connectionString)) throw new Error();
  } catch {
    throw new AssessmentDatabaseError("Assessment database is not configured correctly.", 500);
  }
  if (!pool) {
    pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000,
      idleTimeoutMillis: 30000, statement_timeout: 15000, query_timeout: 20000,
      application_name: "deskilling-assessment" });
    // Pool idle errors can contain connection details; never log the raw error.
    pool.on("error", () => console.error("Assessment database idle connection failed."));
    poolUrl = connectionString;
  }
  return pool;
}

async function query<T extends QueryResultRow>(sql: string, values: unknown[]): Promise<T[]> {
  try {
    // Each allowed call is one atomic DB function. Pool.query releases its client.
    return (await connectionPool().query<T>(sql, values)).rows;
  } catch (error) {
    if (error instanceof AssessmentDatabaseError) throw error;
    const code = typeof error === "object" && error !== null && "code" in error ? error.code : null;
    if (code === "P0001" || (typeof code === "string" && /^(22|23)/.test(code))) {
      throw new AssessmentDatabaseError("Assessment request was rejected by the database. No response was changed.", 400);
    }
    throw new AssessmentDatabaseError("Unable to reach assessment database. Please try again.", 503);
  }
}

export const assessmentDatabase = {
  claim(participantId: string, sessionNumber: number) {
    return query<ClaimRow>("SELECT * FROM public.claim_participant_session_access($1::text, $2::integer)", [participantId, sessionNumber]);
  },
  start(participantId: string, sessionNumber: number) {
    return query<QueueRow>("SELECT * FROM public.start_or_resume_assessment($1::text, $2::integer)", [participantId, sessionNumber]);
  },
  authorize(participantId: string, sessionNumber: number, videoOrder: number) {
    return query<VideoRow>("SELECT * FROM public.authorize_current_assessment_video($1::text, $2::integer, $3::integer)", [participantId, sessionNumber, videoOrder]);
  },
  async submit(p: SubmissionParams) {
    const rows = await query("SELECT public.submit_video_response($1::text, $2::integer, $3::text, $4::integer, $5::boolean, $6::bigint, $7::bigint, $8::boolean, $9::jsonb)",
      [p.p_participant_id, p.p_session_number, p.p_video_id, p.p_video_order, p.p_answer,
        p.p_response_time_ms, p.p_no_response_latency_ms, p.p_video_completed, JSON.stringify(p.p_clicks)]);
    if (rows.length !== 1) throw new AssessmentDatabaseError("Unable to confirm response submission.", 503);
  }
};
