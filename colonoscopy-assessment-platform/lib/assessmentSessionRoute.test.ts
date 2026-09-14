import assert from "node:assert/strict";
import test from "node:test";
import { configure, database, identity, request } from "./postgresRouteFixture.ts";
import { POST } from "../app/api/assessment-session/route.ts";

test("session rejects absent or mismatched cookie before database access", async () => {
  configure();
  const query = database(() => assert.fail("Unauthorized DB call"));
  for (const cookie of [null, { participantId: "P59", sessionNumber: 1 }, { participantId: "P60", sessionNumber: 2 }]) {
    assert.equal((await POST(request("assessment-session", identity, cookie))).status, 403);
  }
  assert.equal(query.mock.callCount(), 0);
});

test("session uses parameterized PostgreSQL with no Supabase configuration", async () => {
  configure();
  database((sql, values) => {
    assert.equal(sql, "SELECT * FROM public.start_or_resume_assessment($1::text, $2::integer)");
    assert.deepEqual(values, ["P60", 1]);
    return [{ video_id: "T1_001", video_order: 1, next_video_order: 1, queue_length: 1, study_mode: "formal" }];
  });
  const response = await POST(request("assessment-session", identity));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).data[0].video_id, "T1_001");
});

test("database outage fails closed without exposing connection details", async () => {
  configure();
  database(() => { throw new Error("postgresql://deskilling_app:private-password@host/db"); });
  const response = await POST(request("assessment-session", identity));
  assert.equal(response.status, 503);
  assert.doesNotMatch(await response.text(), /private-password|postgresql:\/\//);
});
