import assert from "node:assert/strict";
import test from "node:test";
import {
  buildStartOrResumeRpcParams,
  validateAssessmentAccessCode
} from "./sessionConfig.ts";

test("normalizes a coordinator-issued access code", () => {
  assert.equal(
    validateAssessmentAccessCode("  dev-access-code-0123456789  "),
    "dev-access-code-0123456789"
  );
});

test("rejects an access code shorter than the database contract", () => {
  assert.throws(
    () => validateAssessmentAccessCode("short-code"),
    /at least 20 characters/
  );
});

test("builds exactly the three access-code start RPC parameters", () => {
  const params = buildStartOrResumeRpcParams(
    "P001",
    2,
    "coordinator-code-0123456789"
  );

  assert.deepEqual(params, {
    p_participant_id: "P001",
    p_session_number: 2,
    p_access_code: "coordinator-code-0123456789"
  });
  assert.deepEqual(Object.keys(params).sort(), [
    "p_access_code",
    "p_participant_id",
    "p_session_number"
  ]);
});
