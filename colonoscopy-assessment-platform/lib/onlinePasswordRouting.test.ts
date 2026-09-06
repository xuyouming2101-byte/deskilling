import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const clientPath = fileURLToPath(
  new URL("../components/AssessmentClient.tsx", import.meta.url)
);

test("online password request includes participant, session, and password", () => {
  const source = readFileSync(clientPath, "utf8");
  assert.match(source, /participant_id:\s*normalizedParticipantId/);
  assert.match(source, /session_number:\s*parsedSessionNumber/);
  assert.match(source, /password:\s*onlinePassword/);
});

test("participant intake uses P01 account format", () => {
  const source = readFileSync(clientPath, "utf8");
  assert.match(source, /placeholder="P01"/);
});
