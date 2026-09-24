import { createHmac, timingSafeEqual } from "node:crypto";

type CreateSignatureInput = {
  path: string;
  expires: number;
  secret: string;
};

type VerifySignatureInput = CreateSignatureInput & {
  signature: string;
  nowSeconds: number;
};

const FORMAL_VIDEO_PATH_PATTERN =
  /^Test([1-3])\/videos\/T\1_\d{3}\.mp4$/;
const BASELINE_AION_PATH_PATTERN =
  /^Test1\/AION\/videos\/(0[1-9]|[12][0-9]|3[0-9]|40)_ai\.mp4$/;
const BASELINE_AION_H264_PATH_PATTERN =
  /^Test1\/AION\/H264\/(0[1-9]|[12][0-9]|3[0-9]|40)_ai_h264\.mp4$/;

export function isAllowedFormalVideoPath(path: string) {
  return FORMAL_VIDEO_PATH_PATTERN.test(path) || BASELINE_AION_PATH_PATTERN.test(path) || BASELINE_AION_H264_PATH_PATTERN.test(path);
}

function buildSigningPayload(path: string, expires: number) {
  return `${path}\n${expires}`;
}

export function createFormalVideoSignature({
  path,
  expires,
  secret
}: CreateSignatureInput) {
  if (!isAllowedFormalVideoPath(path)) {
    throw new Error("Invalid formal video path.");
  }

  if (!Number.isInteger(expires) || expires <= 0) {
    throw new Error("Invalid formal video expiry.");
  }

  if (!secret) {
    throw new Error("Missing formal video signing secret.");
  }

  return createHmac("sha256", secret)
    .update(buildSigningPayload(path, expires))
    .digest("base64url");
}

export function verifyFormalVideoSignature({
  path,
  expires,
  signature,
  secret,
  nowSeconds
}: VerifySignatureInput) {
  if (
    !isAllowedFormalVideoPath(path) ||
    !Number.isInteger(expires) ||
    expires <= nowSeconds ||
    !signature ||
    !secret
  ) {
    return false;
  }

  let expected: Buffer;
  let received: Buffer;

  try {
    expected = Buffer.from(
      createFormalVideoSignature({ path, expires, secret }),
      "base64url"
    );
    received = Buffer.from(signature, "base64url");
  } catch {
    return false;
  }

  if (expected.length !== received.length) {
    return false;
  }

  return timingSafeEqual(expected, received);
}
