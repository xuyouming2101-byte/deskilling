import { createHmac, timingSafeEqual } from "node:crypto";

export const ASSESSMENT_ACCESS_COOKIE = "assessment_access";
export const ASSESSMENT_ACCESS_MAX_AGE_SECONDS = 24 * 60 * 60;

type CreateTokenInput = {
  participantId: string;
  sessionNumber: number;
  secret: string;
  nowSeconds: number;
  maxAgeSeconds?: number;
};

type VerifyTokenInput = {
  token: string;
  participantId: string;
  sessionNumber: number;
  secret: string;
  nowSeconds: number;
};

type TokenPayload = {
  p: string;
  s: number;
  e: number;
};

function signPayload(encodedPayload: string, secret: string) {
  return createHmac("sha256", secret)
    .update(encodedPayload)
    .digest("base64url");
}

export function createAssessmentAccessToken({
  participantId,
  sessionNumber,
  secret,
  nowSeconds,
  maxAgeSeconds = ASSESSMENT_ACCESS_MAX_AGE_SECONDS
}: CreateTokenInput) {
  if (
    !participantId ||
    !Number.isInteger(sessionNumber) ||
    sessionNumber < 1 ||
    sessionNumber > 3 ||
    !secret ||
    !Number.isInteger(nowSeconds) ||
    !Number.isInteger(maxAgeSeconds) ||
    maxAgeSeconds <= 0
  ) {
    throw new Error("Invalid assessment access token input.");
  }

  const payload: TokenPayload = {
    p: participantId,
    s: sessionNumber,
    e: nowSeconds + maxAgeSeconds
  };

  const encodedPayload = Buffer.from(
    JSON.stringify(payload),
    "utf8"
  ).toString("base64url");

  return `${encodedPayload}.${signPayload(encodedPayload, secret)}`;
}

export function verifyAssessmentAccessToken({
  token,
  participantId,
  sessionNumber,
  secret,
  nowSeconds
}: VerifyTokenInput) {
  if (!token || !participantId || !secret || !Number.isInteger(sessionNumber)) {
    return false;
  }

  const [encodedPayload, signature, extra] = token.split(".");
  if (!encodedPayload || !signature || extra !== undefined) {
    return false;
  }

  const expected = Buffer.from(
    signPayload(encodedPayload, secret),
    "base64url"
  );
  const received = Buffer.from(signature, "base64url");

  if (
    expected.length !== received.length ||
    !timingSafeEqual(expected, received)
  ) {
    return false;
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(
      Buffer.from(encodedPayload, "base64url").toString("utf8")
    ) as TokenPayload;
  } catch {
    return false;
  }

  return (
    payload.p === participantId &&
    payload.s === sessionNumber &&
    Number.isInteger(payload.e) &&
    payload.e > nowSeconds
  );
}

export function readAssessmentAccessCookie(cookieHeader: string | null) {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const trimmed = part.trim();
    const separator = trimmed.indexOf("=");

    if (separator < 1) {
      continue;
    }

    const name = trimmed.slice(0, separator);
    const value = trimmed.slice(separator + 1);

    if (name === ASSESSMENT_ACCESS_COOKIE) {
      return value || null;
    }
  }

  return null;
}

export function buildAssessmentAccessSetCookie(token: string) {
  return [
    `${ASSESSMENT_ACCESS_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${ASSESSMENT_ACCESS_MAX_AGE_SECONDS}`
  ].join("; ");
}
