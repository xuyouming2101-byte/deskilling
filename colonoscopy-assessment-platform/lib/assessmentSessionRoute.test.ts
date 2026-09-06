import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSESSMENT_ACCESS_COOKIE,
  createAssessmentAccessToken
} from "./assessmentAccessToken.ts";

async function loadRoute() {
  return import("../app/api/assessment-session/route.ts");
}

function configure() {
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  process.env.FORMAL_VIDEO_SIGNING_SECRET = "signing-secret";
}

function request(cookie?: string) {
  return new Request("http://localhost/api/assessment-session", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {})
    },
    body: JSON.stringify({
      participant_id: "P60",
      session_number: 1
    })
  });
}

test("assessment session proxy rejects a request without access cookie", async () => {
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

test("assessment session proxy calls start_or_resume with service role", async () => {
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
      "https://example.supabase.co/rest/v1/rpc/start_or_resume_assessment"
    );
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("apikey"), "service-role");
    assert.equal(headers.get("authorization"), "Bearer service-role");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      p_participant_id: "P60",
      p_session_number: 1
    });

    return new Response(
      JSON.stringify([
        {
          video_id: "T1_001",
          video_order: 1,
          next_video_order: 1,
          queue_length: 1,
          study_mode: "formal"
        }
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const response = await POST(
      request(`${ASSESSMENT_ACCESS_COOKIE}=${token}`)
    );
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.equal(Array.isArray(result.data), true);
    assert.equal(result.data[0].video_id, "T1_001");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
