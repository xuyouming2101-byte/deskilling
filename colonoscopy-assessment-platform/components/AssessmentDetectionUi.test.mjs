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
