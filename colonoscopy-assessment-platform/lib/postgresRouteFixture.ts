import assert from "node:assert/strict";
import { afterEach, mock } from "node:test";
import pg from "pg";
import { ASSESSMENT_ACCESS_COOKIE, createAssessmentAccessToken } from "./assessmentAccessToken.ts";

export function configure() {
  for (const key of Object.keys(process.env)) if (key.includes("SUPABASE")) delete process.env[key];
  delete process.env.ASSESSMENT_DEPLOYMENT_MODE;
  process.env.DATABASE_URL = "postgresql://deskilling_app:unit-only@127.0.0.1/deskilling_unit";
  process.env.FORMAL_VIDEO_SIGNING_SECRET = "unit-signing-secret";
  process.env.STUDY_SHARED_PASSWORD = "unit-master-password";
  mock.method(globalThis, "fetch", async () => assert.fail("No external or Supabase request allowed"));
}

export function request(route: string, body: object, identity: { participantId: string; sessionNumber: number } | null = { participantId: "P60", sessionNumber: 1 }) {
  const token = identity && createAssessmentAccessToken({ ...identity, secret: "unit-signing-secret", nowSeconds: Math.floor(Date.now() / 1000) });
  return new Request("http://localhost/api/" + route, {
    method: "POST", headers: { "content-type": "application/json", ...(token ? { cookie: `${ASSESSMENT_ACCESS_COOKIE}=${token}` } : {}) },
    body: JSON.stringify(body)
  });
}

export const identity = { participant_id: "P60", session_number: 1 };
export const submission = { ...identity, video_id: "T1_001", video_order: 1, final_answer: true,
  response_time_ms: 1234, no_response_latency_ms: null, video_completed: true,
  clicks: [{ click_index: 1, video_time_at_click: 12.345, response_time_ms: 1234 }] };

export function database(reply: (sql: string, values: unknown[]) => unknown[]) {
  return mock.method(pg.Pool.prototype, "query", async function (sql: string, values: unknown[]) {
    return { rows: reply(sql, values) };
  });
}
afterEach(() => mock.restoreAll());
