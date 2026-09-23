import assert from "node:assert/strict";
import test from "node:test";
import { configure, database, identity, request } from "./postgresRouteFixture.ts";
import { ASSESSMENT_ACCESS_COOKIE, readAssessmentAccessCookie, verifyAssessmentAccessToken } from "./assessmentAccessToken.ts";
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

test("all participant IDs and sessions require a password before any Day 0 query", async () => {
  configure(); database(() => assert.fail("Missing/wrong password must not query"));
  for (let n=1;n<=60;n++) for (const session_number of [1,2,3]) {
    for (const password of [undefined,"","wrong"]) {
      const response = await POST(request("online-password", {participant_id:`P${String(n).padStart(2,"0")}`,session_number,password},null));
      assert.equal(response.status,401);
      assert.equal(response.headers.get("set-cookie"),null);
    }
  }
});

test("OFF and ON participants use the same password claim and bound cookie", async () => {
  configure();
  const query=database((sql,values)=>{
    assert.equal(sql,"SELECT * FROM public.claim_participant_session_access($1::text, $2::integer)");
    assert.ok(["P01","P20","P21","P40","P41","P58","P59"].includes(values[0] as string));
    assert.equal(values[1],1);
    return [{is_open:true}];
  });
  for (const participantId of ["P01","P20","P21","P40","P41","P58","P59"]) {
    const response=await POST(request("online-password",{participant_id:participantId,session_number:1,password:`deskilling${participantId}`},null));
    assert.equal(response.status,200);
    const header=response.headers.get("set-cookie")!;
    assert.match(header,/HttpOnly/);
    const token=readAssessmentAccessCookie(header)!;
    for(const sessionNumber of [1,2,3]) assert.equal(verifyAssessmentAccessToken({token,participantId,sessionNumber,secret:"unit-signing-secret",nowSeconds:Math.floor(Date.now()/1000)}),sessionNumber===1);
  }
  assert.equal(query.mock.callCount(),7);
});
