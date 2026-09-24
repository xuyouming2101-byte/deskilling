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

test("allows exactly the 40 AI-ON baseline paths without expanding other pools", async () => {
  const { isAllowedFormalVideoPath } = await loadHelper();
  for (let n = 1; n <= 40; n++) {
    assert.equal(isAllowedFormalVideoPath(`Test1/AION/videos/${String(n).padStart(2, "0")}_ai.mp4`), true);
  }
  for (const path of ["Test1/AION/videos/00_ai.mp4", "Test1/AION/videos/41_ai.mp4", "Test1/AION/videos/001_ai.mp4", "Test2/AION/videos/01_ai.mp4", "Test1/AION/videos/../01_ai.mp4", "Test1/AION/videos/%2e%2e/01_ai.mp4", "Test1/AION/videos/01_ai.mp4/extra"]) {
    assert.equal(isAllowedFormalVideoPath(path), false);
  }
});

test("allows only the 40 verified H264 AI-ON copies and binds their signatures", async () => {
  const { isAllowedFormalVideoPath, createFormalVideoSignature, verifyFormalVideoSignature } = await loadHelper();
  const secret="h264-unit-secret",nowSeconds=1800000000,expires=nowSeconds+60;
  for(let n=1;n<=40;n++) {
    const path=`Test1/AION/H264/${String(n).padStart(2,"0")}_ai_h264.mp4`;
    assert.equal(isAllowedFormalVideoPath(path),true);
    const signature=createFormalVideoSignature({path,expires,secret});
    assert.equal(verifyFormalVideoSignature({path,expires,secret,signature,nowSeconds}),true);
    assert.equal(verifyFormalVideoSignature({path:path.replace('H264','videos'),expires,secret,signature,nowSeconds}),false);
  }
  for(const path of ['Test1/AION/H264/00_ai_h264.mp4','Test1/AION/H264/41_ai_h264.mp4','Test1/AION/H264/001_ai_h264.mp4','Test2/AION/H264/01_ai_h264.mp4','Test1/AION/H264/../01_ai_h264.mp4','Test1/AION/H264/%2e%2e/01_ai_h264.mp4','Test1/AION/H264/01_ai.mp4','Test1/AION/H264/01_ai_h264.mp4/extra']) {
    assert.equal(isAllowedFormalVideoPath(path),false);
  }
});

test("signed H264 delivery keeps the protected X-Accel path", async () => {
  const {createFormalVideoSignature}=await loadHelper();
  const {GET}=await import('../app/api/formal-video/route.ts');
  const prior=process.env.FORMAL_VIDEO_SIGNING_SECRET;
  try {
    process.env.FORMAL_VIDEO_SIGNING_SECRET='h264-route-test';
    const path='Test1/AION/H264/40_ai_h264.mp4',expires=Math.floor(Date.now()/1000)+60;
    const sig=createFormalVideoSignature({path,expires,secret:process.env.FORMAL_VIDEO_SIGNING_SECRET});
    const url=new URL('http://127.0.0.1/api/formal-video');
    url.search=new URLSearchParams({path,expires:String(expires),sig}).toString();
    const response=await GET(new Request(url));
    assert.equal(response.status,200);
    assert.equal(response.headers.get('x-accel-redirect'),'/_formal_video/'+path);
    assert.equal(response.headers.get('content-type'),'video/mp4');
    url.searchParams.set('path','Test1/AION/H264/41_ai_h264.mp4');
    assert.equal((await GET(new Request(url))).status,403);
  } finally {
    if(prior===undefined) delete process.env.FORMAL_VIDEO_SIGNING_SECRET;
    else process.env.FORMAL_VIDEO_SIGNING_SECRET=prior;
  }
});

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
