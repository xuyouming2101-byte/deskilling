import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const helperPath = fileURLToPath(
  new URL("./formalVideoAuth.ts", import.meta.url)
);

async function loadHelper() {
  assert.equal(
    existsSync(helperPath),
    true,
    "formalVideoAuth.ts does not exist yet — expected RED"
  );

  return import("./formalVideoAuth.ts");
}

test("accepts only approved formal ECS video paths", async () => {
  const { isAllowedFormalVideoPath } = await loadHelper();

  assert.equal(
    isAllowedFormalVideoPath("Test1/videos/T1_001.mp4"),
    true
  );

  assert.equal(
    isAllowedFormalVideoPath("Test2/videos/T2_040.mp4"),
    true
  );

  assert.equal(
    isAllowedFormalVideoPath("Test3/videos/T3_120.mp4"),
    true
  );
});

test("rejects traversal and malformed video paths", async () => {
  const { isAllowedFormalVideoPath } = await loadHelper();

  assert.equal(
    isAllowedFormalVideoPath("../Test1/videos/T1_001.mp4"),
    false
  );

  assert.equal(
    isAllowedFormalVideoPath("Test1/../T1_001.mp4"),
    false
  );

  assert.equal(
    isAllowedFormalVideoPath("Test1/videos/NEG001.mp4"),
    false
  );

  assert.equal(
    isAllowedFormalVideoPath("Test1/videos/T2_001.mp4"),
    false
  );

  assert.equal(
    isAllowedFormalVideoPath("Test4/videos/T4_001.mp4"),
    false
  );
});

test("accepts a valid unexpired HMAC signature", async () => {
  const {
    createFormalVideoSignature,
    verifyFormalVideoSignature
  } = await loadHelper();

  const path = "Test1/videos/T1_001.mp4";
  const secret = "unit-test-secret";
  const nowSeconds = 1800000000;
  const expires = nowSeconds + 3600;

  const signature = createFormalVideoSignature({
    path,
    expires,
    secret
  });

  assert.match(signature, /^[A-Za-z0-9_-]+$/);

  assert.equal(
    verifyFormalVideoSignature({
      path,
      expires,
      signature,
      secret,
      nowSeconds
    }),
    true
  );
});

test("rejects a tampered signature or tampered path", async () => {
  const {
    createFormalVideoSignature,
    verifyFormalVideoSignature
  } = await loadHelper();

  const path = "Test1/videos/T1_001.mp4";
  const secret = "unit-test-secret";
  const nowSeconds = 1800000000;
  const expires = nowSeconds + 3600;

  const signature = createFormalVideoSignature({
    path,
    expires,
    secret
  });

  assert.equal(
    verifyFormalVideoSignature({
      path,
      expires,
      signature: "wrong-signature",
      secret,
      nowSeconds
    }),
    false
  );

  assert.equal(
    verifyFormalVideoSignature({
      path: "Test1/videos/T1_002.mp4",
      expires,
      signature,
      secret,
      nowSeconds
    }),
    false
  );
});

test("rejects an expired signed URL", async () => {
  const {
    createFormalVideoSignature,
    verifyFormalVideoSignature
  } = await loadHelper();

  const path = "Test1/videos/T1_001.mp4";
  const secret = "unit-test-secret";
  const nowSeconds = 1800000000;
  const expires = nowSeconds - 1;

  const signature = createFormalVideoSignature({
    path,
    expires,
    secret
  });

  assert.equal(
    verifyFormalVideoSignature({
      path,
      expires,
      signature,
      secret,
      nowSeconds
    }),
    false
  );
});
