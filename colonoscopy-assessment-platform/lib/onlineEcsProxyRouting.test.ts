import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const clientPath = fileURLToPath(
  new URL("../components/AssessmentClient.tsx", import.meta.url)
);
const supabaseClientPath = fileURLToPath(
  new URL("./supabaseClient.ts", import.meta.url)
);

test("online assessment queue goes through the ECS proxy", () => {
  const source = readFileSync(clientPath, "utf8");
  assert.match(
    source,
    /loadAssessmentSession\([\s\S]*?parsedSessionNumber,\s*requiresOnlinePassword\s*\)/
  );
});

test("online response submission goes through the ECS proxy", () => {
  const source = readFileSync(clientPath, "utf8");
  assert.match(
    source,
    /submitVideoResponse\(\s*submission,\s*requiresOnlinePassword\s*\)/
  );
});

test("supabase client declares same-origin ECS proxy endpoints", () => {
  const source = readFileSync(supabaseClientPath, "utf8");
  assert.match(source, /ASSESSMENT_SESSION_ENDPOINT\s*=\s*"\/api\/assessment-session"/);
  assert.match(source, /ASSESSMENT_SUBMIT_ENDPOINT\s*=\s*"\/api\/assessment-submit"/);
});
