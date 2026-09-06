import assert from "node:assert/strict";
import test from "node:test";
import {
  isStudyParticipantId,
  participantPassword
} from "./participantAccess.ts";

test("study participant IDs are P01 through P60", () => {
  assert.equal(isStudyParticipantId("P01"), true);
  assert.equal(isStudyParticipantId("P60"), true);
  assert.equal(isStudyParticipantId("P00"), false);
  assert.equal(isStudyParticipantId("P61"), false);
  assert.equal(isStudyParticipantId("P001"), false);
});

test("participant password follows deskillingPxx rule", () => {
  assert.equal(participantPassword("P01"), "deskillingP01");
  assert.equal(participantPassword("P60"), "deskillingP60");
});
