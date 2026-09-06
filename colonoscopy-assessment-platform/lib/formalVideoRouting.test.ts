import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(here, "supabaseClient.ts"), "utf8");

test("keeps DEV on Supabase Edge Function and routes FORMAL to ECS video URL endpoint", () => {
  // Existing DEV path must remain untouched.
  assert.match(source, /issue-assessment-video-url/);

  // New FORMAL path does not exist yet — this is expected to fail in RED.
  assert.match(source, /\/api\/formal-video-url/);

  // Routing must explicitly depend on server-controlled study mode.
  assert.match(source, /studyMode\s*===\s*["']formal["']/);
});
