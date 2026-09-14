import assert from "node:assert/strict";
import { afterEach, mock, test } from "node:test";

test("formal browser flow uses only same-origin APIs with no Supabase configuration", async () => {
  for (const key of Object.keys(process.env)) if (key.includes("SUPABASE")) delete process.env[key];
  const client = await import("./assessmentClient.ts");
  assert.equal(client.isAssessmentConfigured(true), true);
  const calls: string[] = [];
  mock.method(globalThis, "fetch", async (input: string | URL | Request) => {
    const url = String(input); calls.push(url);
    if (url === "/api/assessment-session") return Response.json({ data: [{ video_id: "T1_001", video_order: 1, next_video_order: 1, queue_length: 1, study_mode: "formal" }] });
    if (url === "/api/formal-video-url") return Response.json({ signed_url: "/api/formal-video?path=test&sig=test", video_order: 1, expires_in_seconds: 21600 });
    if (url === "/api/assessment-submit") return Response.json({ saved: true });
    assert.fail("Unexpected network request: " + url);
  });
  const session = await client.loadAssessmentSession("P60", 1, true);
  assert.equal(session.startIndex, 0); assert.equal(session.isComplete, false);
  const video = await client.loadCurrentVideoSource("P60", 1, session.videoQueue[0], session.studyMode, true);
  assert.match(video.signedUrl, /^\/api\/formal-video\?/);
  await client.submitVideoResponse({ participant_id: "P60", session_number: 1, video_id: "T1_001", video_order: 1, final_answer: false, response_time_ms: 1, no_response_latency_ms: 0, video_completed: true, clicks: [] }, true);
  assert.deepEqual(calls, ["/api/assessment-session", "/api/formal-video-url", "/api/assessment-submit"]);
});

test("formal errors never invoke a fallback; completion remains locked", async () => {
  const client = await import("./assessmentClient.ts");
  let count = 0;
  const fetch = mock.method(globalThis, "fetch", async () => { count++; return Response.json({ error: "DB unavailable" }, { status: 503 }); });
  await assert.rejects(client.loadAssessmentSession("P60", 1, true), /DB unavailable/);
  assert.equal(count, 1);
  fetch.mock.mockImplementation(async () => Response.json({ data: [{ video_id: "T1_001", video_order: 1, next_video_order: 2, queue_length: 1, study_mode: "formal" }] }));
  const session = await client.loadAssessmentSession("P60", 1, true);
  assert.equal(session.isComplete, true); assert.equal(session.startIndex, 1);
});
afterEach(() => mock.restoreAll());
