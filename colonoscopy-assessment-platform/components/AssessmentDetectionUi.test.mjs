import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const clientSource = readFileSync(
  new URL("./AssessmentClient.tsx", import.meta.url),
  "utf8"
);
const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8"
);
const layoutSource = readFileSync(
  new URL("../app/layout.tsx", import.meta.url),
  "utf8"
);

test("uses the exact intake title and removes the setup aside without removing form controls", () => {
  assert.match(clientSource, /<h1>lesion detection<\/h1>/);
  assert.match(clientSource, /<main className="assessment-shell" data-phase=\{phase\}>/);
  assert.doesNotMatch(clientSource, /protocol-panel|Assessment setup|Eligible videos|Server controlled|Private study videos|Recorded securely/);
  const intake = clientSource.slice(clientSource.indexOf('{phase === "intake"'), clientSource.indexOf('{phase === "loading"'));
  assert.match(intake, /<form className="intake-panel" onSubmit=\{startAssessment\}>/);
  for (const label of ["Start assessment", "Participant ID", "Session number", "Password"]) {
    assert.ok(intake.includes(label), `Preserve ${label}`);
  }
  assert.match(intake, /requiresOnlinePassword &&/);
  assert.match(intake, /type="password"/);
  assert.match(intake, /type="submit"/);
  assert.match(intake, /passwordVerificationInFlight \? "Checking\.\.\." : "Start"/);
  assert.match(intake, /passwordError &&/);
  assert.match(intake, /intakeError &&/);
  assert.match(layoutSource, /title: "lesion detection"/);
  assert.match(layoutSource, /description: "Video-based lesion detection assessment\."/);
});

test("limits only intake width and keeps mobile gutters and shared metric styles", () => {
  assert.match(stylesSource, /\.assessment-shell\[data-phase="intake"\]\s*\{[^}]*width:\s*min\(760px, calc\(100% - 32px\)\);/s);
  assert.match(stylesSource, /\.intake-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/s);
  assert.match(stylesSource, /\.metric-row\s*\{/);
});

test("keeps the approved wide participant assessment layout", () => {
  assert.doesNotMatch(
    clientSource,
    /Watch the video and record each lesion when detected\./
  );
  assert.match(
    stylesSource,
    /\.assessment-shell\s*\{[^}]*width:\s*min\(1496px, calc\(100% - 32px\)\);/s
  );
  assert.match(
    stylesSource,
    /\.assessment-shell\s*\{[^}]*justify-content:\s*center;/s
  );
  assert.match(
    stylesSource,
    /\.assessment-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1045px\) 368px;/s
  );
  assert.match(
    stylesSource,
    /\.assessment-grid\s*\{[^}]*gap:\s*28px;/s
  );
  assert.match(
    stylesSource,
    /\.assessment-video-player video\s*\{[^}]*aspect-ratio:\s*800 \/ 456;/s
  );
  assert.match(
    stylesSource,
    /\.response-panel\s*\{[^}]*min-height:\s*719px;/s
  );
});
