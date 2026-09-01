import assert from "node:assert/strict";
import test from "node:test";
import { buildStartOrResumeRpcParams } from "./sessionConfig.ts";

test("builds exactly the current two-parameter start RPC contract", () => {
  const params = buildStartOrResumeRpcParams("P001", 2);

  assert.deepEqual(params, {
    p_participant_id: "P001",
    p_session_number: 2
  });
  assert.deepEqual(Object.keys(params).sort(), [
    "p_participant_id",
    "p_session_number"
  ]);
});
