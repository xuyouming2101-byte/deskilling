import assert from "node:assert/strict";
import test from "node:test";
import { configure, database, request, submission } from "./postgresRouteFixture.ts";
import { POST } from "../app/api/assessment-submit/route.ts";

test("submit rejects absent and wrong identity/session cookies", async () => {
  configure(); database(() => assert.fail("Unauthorized DB call"));
  for (const cookie of [null, { participantId: "P59", sessionNumber: 1 }, { participantId: "P60", sessionNumber: 2 }]) {
    assert.equal((await POST(request("assessment-submit", submission, cookie))).status, 403);
  }
});

test("submit preserves marks/NULL/boolean/bigint parameters and serializes JSONB explicitly", async () => {
  configure();
  database((sql, values) => {
    assert.equal(sql, "SELECT public.submit_video_response($1::text, $2::integer, $3::text, $4::integer, $5::boolean, $6::bigint, $7::bigint, $8::boolean, $9::jsonb)");
    assert.deepEqual(values, ["P60", 1, "T1_001", 1, true, 1234, null, true, JSON.stringify(submission.clicks)]);
    return [{ submit_video_response: "" }];
  });
  const response = await POST(request("assessment-submit", submission));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { saved: true });
});

test("no-lesion sends an empty JSON array and failed atomic submission never reports saved", async () => {
  configure();
  database((sql, values) => {
    assert.match(sql, /\$9::jsonb/);
    assert.equal(values[4], false); assert.equal(values[6], 0); assert.equal(values[8], "[]");
    throw Object.assign(new Error("existing response differs from retry payload"), { code: "P0001" });
  });
  const response = await POST(request("assessment-submit", { ...submission, final_answer: false, no_response_latency_ms: 0, clicks: [] }));
  assert.equal(response.status, 400);
  assert.notEqual((await response.json()).saved, true);
});
