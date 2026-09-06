import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createFormalVideoSignature } from "./formalVideoAuth.ts";

const routePath = fileURLToPath(
  new URL("../app/api/formal-video/route.ts", import.meta.url)
);

async function loadRoute() {
  assert.equal(
    existsSync(routePath),
    true,
    "formal-video route does not exist yet — expected RED"
  );

  return import("../app/api/formal-video/route.ts");
}

function signedRequest({
  path,
  expires,
  signature
}: {
  path: string;
  expires: number;
  signature: string;
}) {
  const url = new URL("http://localhost/api/formal-video");
  url.searchParams.set("path", path);
  url.searchParams.set("expires", String(expires));
  url.searchParams.set("sig", signature);

  return new Request(url);
}

test("valid signed formal video returns X-Accel-Redirect", async () => {
  const { GET } = await loadRoute();

  const secret = "route-test-secret";
  process.env.FORMAL_VIDEO_SIGNING_SECRET = secret;

  const path = "Test1/videos/T1_001.mp4";
  const expires = Math.floor(Date.now() / 1000) + 3600;

  const signature = createFormalVideoSignature({
    path,
    expires,
    secret
  });

  const response = await GET(
    signedRequest({ path, expires, signature })
  );

  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get("x-accel-redirect"),
    "/_formal_video/Test1/videos/T1_001.mp4"
  );
  assert.equal(
    response.headers.get("cache-control"),
    "private, no-store"
  );
});

test("invalid signature is rejected", async () => {
  const { GET } = await loadRoute();

  process.env.FORMAL_VIDEO_SIGNING_SECRET = "route-test-secret";

  const path = "Test1/videos/T1_001.mp4";
  const expires = Math.floor(Date.now() / 1000) + 3600;

  const response = await GET(
    signedRequest({
      path,
      expires,
      signature: "invalid-signature"
    })
  );

  assert.equal(response.status, 403);
  assert.equal(response.headers.get("x-accel-redirect"), null);
});

test("expired signed URL is rejected", async () => {
  const { GET } = await loadRoute();

  const secret = "route-test-secret";
  process.env.FORMAL_VIDEO_SIGNING_SECRET = secret;

  const path = "Test1/videos/T1_001.mp4";
  const expires = Math.floor(Date.now() / 1000) - 1;

  const signature = createFormalVideoSignature({
    path,
    expires,
    secret
  });

  const response = await GET(
    signedRequest({ path, expires, signature })
  );

  assert.equal(response.status, 403);
});

test("path traversal is rejected", async () => {
  const { GET } = await loadRoute();

  process.env.FORMAL_VIDEO_SIGNING_SECRET = "route-test-secret";

  const response = await GET(
    signedRequest({
      path: "../Test1/videos/T1_001.mp4",
      expires: Math.floor(Date.now() / 1000) + 3600,
      signature: "anything"
    })
  );

  assert.equal(response.status, 403);
});

test("missing server signing secret fails closed", async () => {
  const { GET } = await loadRoute();

  delete process.env.FORMAL_VIDEO_SIGNING_SECRET;

  const response = await GET(
    signedRequest({
      path: "Test1/videos/T1_001.mp4",
      expires: Math.floor(Date.now() / 1000) + 3600,
      signature: "anything"
    })
  );

  assert.equal(response.status, 500);
});
