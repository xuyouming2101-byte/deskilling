import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const routePath = fileURLToPath(
  new URL("../app/api/formal-video-url/route.ts", import.meta.url)
);

async function loadRoute() {
  assert.equal(
    existsSync(routePath),
    true,
    "formal-video-url route does not exist yet — expected RED"
  );

  return import("../app/api/formal-video-url/route.ts");
}

function requestBody() {
  return new Request("http://localhost/api/formal-video-url", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      participant_id: "P001",
      session_number: 1,
      video_order: 1
    })
  });
}

test("missing server configuration fails closed", async () => {
  const { POST } = await loadRoute();

  delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.FORMAL_VIDEO_SIGNING_SECRET;

  const response = await POST(requestBody());

  assert.equal(response.status, 500);
});

test("Supabase authorization failure is rejected", async () => {
  const { POST } = await loadRoute();

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  process.env.FORMAL_VIDEO_SIGNING_SECRET = "test-signing-secret";

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ message: "denied" }), {
      status: 400,
      headers: { "content-type": "application/json" }
    });

  try {
    const response = await POST(requestBody());
    assert.equal(response.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("authorized non-ECS video is rejected", async () => {
  const { POST } = await loadRoute();

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  process.env.FORMAL_VIDEO_SIGNING_SECRET = "test-signing-secret";

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(
      JSON.stringify([
        {
          bucket: "SSL",
          file_path: "video_001.mp4"
        }
      ]),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );

  try {
    const response = await POST(requestBody());
    assert.equal(response.status, 403);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("authorized FORMAL_ECS video receives a six-hour signed URL", async () => {
  const { POST } = await loadRoute();

  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role";
  process.env.FORMAL_VIDEO_SIGNING_SECRET = "test-signing-secret";

  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (input, init) => {
    assert.equal(
      String(input),
      "https://example.supabase.co/rest/v1/rpc/authorize_current_assessment_video"
    );

    assert.equal(init?.method, "POST");

    const headers = new Headers(init?.headers);
    assert.equal(headers.get("apikey"), "test-service-role");
    assert.equal(
      headers.get("authorization"),
      "Bearer test-service-role"
    );

    const body = JSON.parse(String(init?.body));

    assert.deepEqual(body, {
      p_participant_id: "P001",
      p_session_number: 1,
      p_video_order: 1
    });

    return new Response(
      JSON.stringify([
        {
          bucket: "FORMAL_ECS",
          file_path: "Test1/videos/T1_001.mp4"
        }
      ]),
      {
        status: 200,
        headers: { "content-type": "application/json" }
      }
    );
  };

  try {
    const response = await POST(requestBody());

    assert.equal(response.status, 200);

    const result = await response.json();

    assert.equal(result.video_order, 1);
    assert.equal(result.expires_in_seconds, 21600);

    assert.match(
      result.signed_url,
      /^\/api\/formal-video\?/
    );

    const signed = new URL(
      result.signed_url,
      "http://localhost"
    );

    assert.equal(
      signed.searchParams.get("path"),
      "Test1/videos/T1_001.mp4"
    );

    assert.ok(signed.searchParams.get("expires"));
    assert.ok(signed.searchParams.get("sig"));
  } finally {
    globalThis.fetch = originalFetch;
  }
});
