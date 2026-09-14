import assert from "node:assert/strict";
import test from "node:test";
import { configure, database, identity, request } from "./postgresRouteFixture.ts";
import { ASSESSMENT_ACCESS_COOKIE } from "./assessmentAccessToken.ts";
import { POST } from "../app/api/online-password/route.ts";

test("master returns bound HttpOnly cookie without any schedule query", async () => {
  configure(); database(() => assert.fail("Master must not claim Day 0"));
  const response = await POST(request("online-password", { ...identity, session_number: 3, password: "unit-master-password" }, null));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authorized: true, master: true });
  assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`^${ASSESSMENT_ACCESS_COOKIE}=`));
  assert.match(response.headers.get("set-cookie") ?? "", /HttpOnly/);
});
test("ordinary participant uses parameterized claim and gets the existing cookie", async () => {
  configure(); database((sql, values) => {
    assert.equal(sql, "SELECT * FROM public.claim_participant_session_access($1::text, $2::integer)");
    assert.deepEqual(values, ["P60", 1]);
    return [{ opens_at: new Date(), server_now: new Date(), is_open: true }];
  });
  const response = await POST(request("online-password", { ...identity, password: "deskillingP60" }, null));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { authorized: true, master: false });
  assert.match(response.headers.get("set-cookie") ?? "", new RegExp(`^${ASSESSMENT_ACCESS_COOKIE}=`));
});
test("wrong password is rejected before schedule lookup", async () => {
  configure(); database(() => assert.fail("Wrong password must not query"));
  const response = await POST(request("online-password", { ...identity, password: "wrong" }, null));
  assert.equal(response.status, 401); assert.equal(response.headers.get("set-cookie"), null);
});
test("not-yet-open session is rejected without cookie", async () => {
  configure(); database(() => [{ is_open: false }]);
  const response = await POST(request("online-password", { ...identity, password: "deskillingP60" }, null));
  assert.equal(response.status, 403); assert.equal(response.headers.get("set-cookie"), null);
});
