import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSESSMENT_ACCESS_COOKIE,
  createAssessmentAccessToken
} from "./assessmentAccessToken.ts";

async function loadRoute() {
  return import("../app/api/assessment-submit/route.ts");
}

function configure() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  process.env.FORMAL_VIDEO_SIGNING_SECRET = "signing-secret";
}

const submission = {
  participant_id: "P60",
  session_number: 1,
  video_id: "T1_001",
  video_order: 1,
  final_answer: true,
  response_time_ms: 1234,
  no_response_latency_ms: null,
  video_completed: true,
  clicks: [
    {
      click_index: 1,
      video_time_at_click: 12.345,
      response_time_ms: 1234
    }
  ]
};

function request(cookie?: string) {
  return new Request("http://localhost/api/assessment-submit", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify(submission)
  });
}

test("assessment submit proxy rejects a request without access cookie", async () => {
  const { POST } = await loadRoute();
  configure();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    assert.fail("unauthorized request must not reach Supabase");
  };

  try {
    const response = await POST(request());
    assert.equal(response.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("assessment submit proxy calls submit_video_response with service role", async () => {
  const { POST } = await loadRoute();
  configure();

  const token = createAssessmentAccessToken({
    participantId: "P60",
    sessionNumber: 1,
    secret: "signing-secret",
    nowSeconds: Math.floor(Date.now() / 1000)
  });

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(
      String(input),
      "https://example.supabase.co/rest/v1/rpc/submit_video_response"
    );
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("apikey"), "service-role");
    assert.equal(headers.get("authorization"), "Bearer service-role");

    const body = JSON.parse(String(init?.body));
    assert.equal(body.p_participant_id, "P60");
    assert.equal(body.p_session_number, 1);
    assert.equal(body.p_video_id, "T1_001");
    assert.equal(body.p_video_order, 1);
    assert.equal(body.p_answer, true);
    assert.deepEqual(body.p_clicks, [
      {
        click_index: 1,
        video_time_at_click: 12.345,
        response_time_ms: 1234
      }
    ]);

    return new Response(null, { status: 204 });
  };

  try {
    const response = await POST(
      request(`${ASSESSMENT_ACCESS_COOKIE}=${token}`)
    );
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { saved: true });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
