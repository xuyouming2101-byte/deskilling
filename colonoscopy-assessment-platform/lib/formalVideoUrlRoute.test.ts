import assert from "node:assert/strict";
import test from "node:test";
import { configure, database, identity, request } from "./postgresRouteFixture.ts";
import { POST } from "../app/api/formal-video-url/route.ts";
const body = { ...identity, video_order: 1 };

test("missing formal video server configuration fails closed", async () => {
  configure(); delete process.env.DATABASE_URL;
  assert.equal((await POST(request("formal-video-url", body))).status, 500);
});
test("formal authorization rejects missing or wrong cookie", async () => {
  configure(); database(() => assert.fail("Unauthorized DB call"));
  for (const cookie of [null, { participantId: "P59", sessionNumber: 1 }, { participantId: "P60", sessionNumber: 2 }]) {
    assert.equal((await POST(request("formal-video-url", body, cookie))).status, 403);
  }
});
test("database current-video authorization failure is rejected", async () => {
  configure(); database(() => { throw Object.assign(new Error("assessment video is not available"), { code: "P0001" }); });
  assert.equal((await POST(request("formal-video-url", body))).status, 403);
});
test("authorized non-ECS video or unsafe path is rejected", async () => {
  configure();
  let row = { bucket: "SSL", file_path: "video_001.mp4" };
  database(() => [row]);
  assert.equal((await POST(request("formal-video-url", body))).status, 403);
  row = { bucket: "FORMAL_ECS", file_path: "../private.mp4" };
  assert.equal((await POST(request("formal-video-url", body))).status, 403);
});
test("authorized FORMAL_ECS video receives the unchanged six-hour relative HMAC URL", async () => {
  configure(); database((sql, values) => {
    assert.equal(sql, "SELECT * FROM public.authorize_current_assessment_video($1::text, $2::integer, $3::integer)");
    assert.deepEqual(values, ["P60", 1, 1]);
    return [{ bucket: "FORMAL_ECS", file_path: "Test1/videos/T1_001.mp4" }];
  });
  const response = await POST(request("formal-video-url", body));
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(result.video_order, 1); assert.equal(result.expires_in_seconds, 21600);
  assert.match(result.signed_url, /^\/api\/formal-video\?/);
  const signed = new URL(result.signed_url, "http://localhost");
  assert.equal(signed.searchParams.get("path"), "Test1/videos/T1_001.mp4");
  assert.ok(signed.searchParams.get("expires")); assert.ok(signed.searchParams.get("sig"));
});
