import assert from "node:assert/strict";
import test from "node:test";
import {
  ASSESSMENT_ACCESS_COOKIE,
  createAssessmentAccessToken,
  readAssessmentAccessCookie,
  verifyAssessmentAccessToken
} from "./assessmentAccessToken.ts";

const secret = "test-secret";
const nowSeconds = 1_800_000_000;

test("assessment access token is bound to participant and session", () => {
  const token = createAssessmentAccessToken({
    participantId: "P60",
    sessionNumber: 1,
    secret,
    nowSeconds
  });

  assert.equal(
    verifyAssessmentAccessToken({
      token,
      participantId: "P60",
      sessionNumber: 1,
      secret,
      nowSeconds: nowSeconds + 60
    }),
    true
  );

  assert.equal(
    verifyAssessmentAccessToken({
      token,
      participantId: "P59",
      sessionNumber: 1,
      secret,
      nowSeconds: nowSeconds + 60
    }),
    false
  );

  assert.equal(
    verifyAssessmentAccessToken({
      token,
      participantId: "P60",
      sessionNumber: 2,
      secret,
      nowSeconds: nowSeconds + 60
    }),
    false
  );
});

test("expired assessment access token is rejected", () => {
  const token = createAssessmentAccessToken({
    participantId: "P01",
    sessionNumber: 1,
    secret,
    nowSeconds,
    maxAgeSeconds: 10
  });

  assert.equal(
    verifyAssessmentAccessToken({
      token,
      participantId: "P01",
      sessionNumber: 1,
      secret,
      nowSeconds: nowSeconds + 11
    }),
    false
  );
});

test("assessment cookie parser extracts only the named cookie", () => {
  const token = "abc.def";
  assert.equal(
    readAssessmentAccessCookie(
      `foo=bar; ${ASSESSMENT_ACCESS_COOKIE}=${token}; another=value`
    ),
    token
  );
  assert.equal(readAssessmentAccessCookie("foo=bar"), null);
});
