import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const clientSource = readFileSync(
  new URL("./AssessmentClient.tsx", import.meta.url),
  "utf8"
);
const routeSource = readFileSync(
  new URL("../app/api/online-password/route.ts", import.meta.url),
  "utf8"
);
const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");

test("keeps the password field inside the shared intake form for ONLINE only", () => {
  assert.match(pageSource, /<AssessmentClient requiresOnlinePassword \/>/);
  assert.match(clientSource, /requiresOnlinePassword/);
  assert.match(clientSource, /<span>Password<\/span>/);
  assert.match(clientSource, /type="password"/);
  assert.match(clientSource, /fetch\("\/api\/online-password"/);
  assert.doesNotMatch(pageSource, /OnlinePasswordGate/);
  assert.doesNotMatch(clientSource, /123456@/);
});

test("keeps password verification server-side and leaves LOCAL un-gated", () => {
  assert.match(routeSource, /process\.env\.STUDY_SHARED_PASSWORD/);
  assert.match(routeSource, /ASSESSMENT_DEPLOYMENT_MODE === "local"/);
  assert.doesNotMatch(routeSource, /123456@/);
  assert.doesNotMatch(clientSource, /NEXT_PUBLIC.*PASSWORD|STUDY_SHARED_PASSWORD/);
});
