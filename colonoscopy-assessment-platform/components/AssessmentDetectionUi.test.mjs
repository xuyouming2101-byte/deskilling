import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const clientSource = readFileSync(
  new URL("./AssessmentClient.tsx", import.meta.url),
  "utf8"
);
const surveySource = readFileSync(
  new URL("./LesionSurvey.tsx", import.meta.url),
  "utf8"
);
const playerSource = readFileSync(
  new URL("./AssessmentVideoPlayer.tsx", import.meta.url),
  "utf8"
);
const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
const stylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8"
);
const diagnosticsPath = new URL("./AssessmentDevDiagnostics.tsx", import.meta.url);
const gatePath = new URL("../lib/runtime/devDiagnostics.ts", import.meta.url);

test("matches the approved clinical assessment hierarchy", () => {
  assert.doesNotMatch(clientSource, /<p className="eyebrow">Video assessment<\/p>/);
  assert.doesNotMatch(clientSource, /className="status-pill"/);
  assert.match(clientSource, /<span>\{progressPercent\}% complete<\/span>/);
  assert.match(
    clientSource,
    /Watch the video and record each lesion when detected\./
  );
  assert.match(
    clientSource,
    /Mark each visible lesion when you first detect it\./
  );
  assert.doesNotMatch(
    clientSource,
    /Cannot play video \$\{currentVideo\.videoId\}/
  );
  assert.doesNotMatch(clientSource, /<span>\{currentVideo\.videoId\}<\/span>/);
});

test("keeps participant-facing technical details out of the shared core", () => {
  for (const technicalLabel of [
    "Supabase",
    "SQLite",
    "Storage",
    "public.responses",
    "package checksum"
  ]) {
    assert.doesNotMatch(clientSource, new RegExp(technicalLabel, "i"));
    assert.doesNotMatch(surveySource, new RegExp(technicalLabel, "i"));
    assert.doesNotMatch(playerSource, new RegExp(technicalLabel, "i"));
  }
});

test("uses the existing shared assessment tree with separately gated diagnostics", () => {
  assert.ok(existsSync(diagnosticsPath), "Expected a subordinate DEV diagnostics component.");
  assert.ok(existsSync(gatePath), "Expected a server-only DEV diagnostics gate.");
  assert.match(clientSource, /devDiagnosticsEnabled\?: boolean/);
  assert.match(clientSource, /<AssessmentDevDiagnostics/);
  assert.equal(clientSource.match(/className="assessment-grid"/g)?.length, 1);
  assert.doesNotMatch(
    clientSource,
    /LocalAssessmentUI|OnlineAssessmentUI|DevAssessmentUI/
  );
  assert.match(pageSource, /readDevDiagnosticsGate/);
  assert.match(pageSource, /devDiagnosticsEnabled=\{devDiagnosticsEnabled\}/);
});

test("renders Figma-aligned marks and restrained clinical styling", () => {
  assert.match(surveySource, /import \{[^}]*\bPlus\b[^}]*\} from "lucide-react"/s);
  assert.doesNotMatch(surveySource, /\bScanSearch\b/);
  assert.match(surveySource, /<span>Delete<\/span>/);
  assert.match(stylesSource, /\.assessment-shell\s*\{[^}]*--bg:\s*#f6f8f7;/s);
  assert.match(stylesSource, /body:has\(\.assessment-shell\)\s*\{[^}]*background:\s*#f6f8f7;/s);
  assert.match(clientSource, /data-dev-diagnostics=\{devDiagnosticsEnabled \? "true" : "false"\}/);
  assert.match(stylesSource, /body:has\(\.assessment-shell\[data-dev-diagnostics="true"\]\)\s*\{[^}]*background:\s*#eef1f0;/s);
  assert.match(stylesSource, /\.assessment-shell\s*\{[^}]*padding:\s*38px 0 44px;/s);
  assert.match(stylesSource, /\.topbar\s*\{[^}]*margin-bottom:\s*26px;/s);
  assert.match(stylesSource, /\.workbench\s*\{[^}]*gap:\s*33px;/s);
  assert.match(stylesSource, /\.progress-block\s*\{[^}]*gap:\s*11px;/s);
  assert.match(stylesSource, /\.assessment-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 800px\) 350px;/s);
  assert.match(stylesSource, /\.assessment-grid\s*\{[^}]*gap:\s*30px;/s);
  assert.match(stylesSource, /\.assessment-video-player video\s*\{[^}]*aspect-ratio:\s*800 \/ 456;/s);
  assert.match(stylesSource, /\.detection-button\s*\{[^}]*justify-content:\s*flex-start;[^}]*min-height:\s*72px;/s);
  assert.match(stylesSource, /\.response-panel\s*\{[^}]*min-height:\s*548px;/s);
  assert.doesNotMatch(stylesSource, /\.progress-fill\s*\{[^}]*linear-gradient/s);
});
