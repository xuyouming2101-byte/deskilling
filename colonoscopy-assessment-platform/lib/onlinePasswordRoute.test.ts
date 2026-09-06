import assert from "node:assert/strict";
import test from "node:test";
import { ASSESSMENT_ACCESS_COOKIE } from "./assessmentAccessToken.ts";

async function loadRoute() {
  return import("../app/api/online-password/route.ts");
}

function req(participantId: string, sessionNumber: number, password: string) {
  return new Request("http://localhost/api/online-password", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      participant_id: participantId,
      session_number: sessionNumber,
      password
    })
  });
}

function configure() {
  delete process.env.ASSESSMENT_DEPLOYMENT_MODE;
  process.env.STUDY_SHARED_PASSWORD = "123456@";
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role";
  process.env.FORMAL_VIDEO_SIGNING_SECRET = "signing-secret";
}

test("master password returns access cookie without schedule lookup", async () => {
  const { POST } = await loadRoute();
  configure();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    assert.fail("master password must not call schedule RPC");
  };

  try {
    const response = await POST(req("P59", 3, "123456@"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      authorized: true,
      master: true
    });
    assert.match(
      response.headers.get("set-cookie") ?? "",
      new RegExp(`^${ASSESSMENT_ACCESS_COOKIE}=`)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ordinary participant gets access cookie after schedule claim", async () => {
  const { POST } = await loadRoute();
  configure();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify([
        {
          opens_at: "2026-09-06T07:30:00Z",
          server_now: "2026-09-06T07:30:00Z",
          is_open: true
        }
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  try {
    const response = await POST(req("P60", 1, "deskillingP60"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      authorized: true,
      master: false
    });
    assert.match(
      response.headers.get("set-cookie") ?? "",
      new RegExp(`^${ASSESSMENT_ACCESS_COOKIE}=`)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("wrong password is rejected before schedule lookup", async () => {
  const { POST } = await loadRoute();
  configure();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    assert.fail("wrong credentials must not call schedule RPC");
  };

  try {
    const response = await POST(req("P60", 1, "wrong"));
    assert.equal(response.status, 401);
    assert.equal(response.headers.get("set-cookie"), null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
