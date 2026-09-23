import assert from "node:assert/strict";
import test from "node:test";
import {
  isStudyParticipantId,
  participantPassword
} from "./participantAccess.ts";

test("study participant IDs are exactly P01 through P100", () => {
  for (let n = 1; n <= 100; n++) {
    assert.equal(isStudyParticipantId(`P${String(n).padStart(2, "0")}`), true);
  }
  for (const id of ["P00", "P1", "P001", "P0100", "P101", "P110", "p61", "P61 "]) {
    assert.equal(isStudyParticipantId(id), false);
  }
});

test("participant password follows deskillingPxx rule", () => {
  assert.equal(participantPassword("P01"), "deskillingP01");
  assert.equal(participantPassword("P60"), "deskillingP60");
  assert.equal(participantPassword("P61"), "deskillingP61");
  assert.equal(participantPassword("P100"), "deskillingP100");
});
