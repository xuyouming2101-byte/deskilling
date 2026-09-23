import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import test from "node:test";
import { configure, database, request } from "./postgresRouteFixture.ts";
import { readAssessmentAccessCookie, verifyAssessmentAccessToken } from "./assessmentAccessToken.ts";

async function route() {
  assert.ok(existsSync(new URL("../app/api/baseline-access/route.ts", import.meta.url)), "Scoped baseline endpoint must exist");
  return import("../app/api/baseline-access/route.ts");
}

test("baseline ID-only claims only Session 1 and binds the existing cookie", async () => {
  configure();
  const { POST } = await route();
  const query = database((sql, values) => {
    assert.equal(sql, "SELECT * FROM public.claim_participant_session_access($1::text, $2::integer)");
    assert.ok(values[0] === "P21" || values[0] === "P40");
    assert.equal(values[1], 1);
    return [{ is_open: true }];
  });
  for (const id of ["P21", "P40"]) {
    const response = await POST(request("baseline-access", { participant_id: id }, null));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authorized: true });
    const header = response.headers.get("set-cookie");
    assert.match(header!, /HttpOnly/);
    const token = readAssessmentAccessCookie(header)!;
    for (const [participantId, sessionNumber, expected] of [[id, 1, true], [id, 2, false], ["P20", 1, false]] as const) {
      assert.equal(verifyAssessmentAccessToken({ token, participantId, sessionNumber, secret: "unit-signing-secret", nowSeconds: Math.floor(Date.now()/1000) }), expected);
    }
  }
  assert.equal(query.mock.callCount(), 2);
});

test("baseline rejects other IDs, client session selection and malformed input before any claim", async () => {
  configure(); const { POST } = await route();
  database(() => assert.fail("Rejected input must not claim Day 0"));
  for (const body of [null, [], {}, { participant_id: "P20" }, { participant_id: "P41" }, { participant_id: "P021" }, { participant_id: "P21", session_number: 2 }, { participant_id: "P21", session_number: 1 }, { participant_id: "P21", ai_condition: "off" }]) {
    const response = await POST(new Request("http://localhost/api/baseline-access", { method: "POST", body: JSON.stringify(body) }));
    assert.equal(response.status, 403);
    assert.equal(response.headers.get("set-cookie"), null);
  }
});

test("baseline fails closed when local, unconfigured or claim fails", async () => {
  configure(); const { POST } = await route();
  const makeRequest = () => request("baseline-access", { participant_id: "P21" }, null);
  process.env.ASSESSMENT_DEPLOYMENT_MODE = "local";
  assert.equal((await POST(makeRequest())).status, 404);
  delete process.env.ASSESSMENT_DEPLOYMENT_MODE;
  delete process.env.FORMAL_VIDEO_SIGNING_SECRET;
  assert.equal((await POST(makeRequest())).status, 500);
  process.env.FORMAL_VIDEO_SIGNING_SECRET = "unit-signing-secret";
  database(() => { throw new Error("connection failed"); });
  const failed = await POST(makeRequest());
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get("set-cookie"), null);
});
