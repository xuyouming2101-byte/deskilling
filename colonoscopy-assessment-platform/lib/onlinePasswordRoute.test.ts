import assert from "node:assert/strict";
import test from "node:test";

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
}

test("master password bypasses account and schedule and does not claim Day 0", async () => {
  const { POST } = await loadRoute();
  configure();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    assert.fail("master password must not call schedule RPC");
  };

  try {
    const response = await POST(req("ADMIN_TEST", 3, "123456@"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      authorized: true,
      master: true
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ordinary P01 Session 1 uses claim RPC and succeeds when open", async () => {
  const { POST } = await loadRoute();
  configure();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    assert.equal(
      String(input),
      "https://example.supabase.co/rest/v1/rpc/claim_participant_session_access"
    );
    assert.equal(init?.method, "POST");

    const body = JSON.parse(String(init?.body));
    assert.deepEqual(body, {
      p_participant_id: "P01",
      p_session_number: 1
    });

    return new Response(
      JSON.stringify([
        {
          opens_at: "2026-09-06T07:30:00Z",
          server_now: "2026-09-06T07:30:00Z",
          is_open: true
        }
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    );
  };

  try {
    const response = await POST(req("p01", 1, "deskillingP01"));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      authorized: true,
      master: false
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ordinary account is blocked before a later session opens", async () => {
  const { POST } = await loadRoute();
  configure();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(
      JSON.stringify([
        {
          opens_at: "2026-09-20T07:30:00Z",
          server_now: "2026-09-06T07:30:00Z",
          is_open: false
        }
      ]),
      { status: 200, headers: { "content-type": "application/json" } }
    );

  try {
    const response = await POST(req("P01", 2, "deskillingP01"));
    assert.equal(response.status, 403);
    const result = await response.json();
    assert.equal(result.error, "This session is not yet available.");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("wrong participant password is rejected before schedule lookup", async () => {
  const { POST } = await loadRoute();
  configure();

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    assert.fail("wrong credentials must not call schedule RPC");
  };

  try {
    const response = await POST(req("P02", 1, "deskillingP01"));
    assert.equal(response.status, 401);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
