import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const assessmentClientSource = readFileSync(
  new URL("./AssessmentClient.tsx", import.meta.url),
  "utf8"
);
const lesionSurveySource = readFileSync(
  new URL("./LesionSurvey.tsx", import.meta.url),
  "utf8"
);
const assessmentTypesSource = readFileSync(
  new URL("../lib/assessmentTypes.ts", import.meta.url),
  "utf8"
);
const supabaseClientSource = readFileSync(
  new URL("../lib/supabaseClient.ts", import.meta.url),
  "utf8"
);
const globalStylesSource = readFileSync(
  new URL("../app/globals.css", import.meta.url),
  "utf8"
);
const componentAndLibSource = [
  assessmentClientSource,
  lesionSurveySource,
  assessmentTypesSource,
  supabaseClientSource
].join("\n");
const staleSymbols = [
  ["insert", "Response"].join(""),
  ["Response", "Insert"].join(""),
  ["RESPONSE", "_INSERT_COLUMNS"].join(""),
  ["Response", "Type"].join(""),
  ["response", "LockedRef"].join(""),
  ["submitted", "Ref"].join("")
];

function getFunctionBody(source, name) {
  const match = source.match(
    new RegExp(`(?:const|function) ${name}[^=]*=?(?: async)? \\([^)]*\\) => \\{(?<body>[\\s\\S]*?)\\n  \\};`)
  );

  assert.ok(match?.groups?.body, `Expected a ${name} function body.`);
  return match.groups.body;
}

function assertLexicalOrder(body, statements) {
  const positions = statements.map((statement) => {
    const position = body.indexOf(statement);
    assert.notEqual(position, -1, `Expected function to contain: ${statement}`);
    return position;
  });

  for (let index = 1; index < positions.length; index += 1) {
    assert.ok(
      positions[index - 1] < positions[index],
      `Expected ${statements[index - 1]} to precede ${statements[index]}.`
    );
  }
}

test("integrates the seek-free player and atomic submission client", () => {
  assert.match(assessmentClientSource, /import AssessmentVideoPlayer/);
  assert.match(assessmentClientSource, /<AssessmentVideoPlayer/);
  assert.match(assessmentClientSource, /submitVideoResponse/);
  assert.doesNotMatch(assessmentClientSource, /<video\b/);
});

test("uses only the server-owned safe queue RPC with a browser-local access token", () => {
  assert.match(supabaseClientSource, /start_or_resume_assessment/);
  assert.match(supabaseClientSource, /p_access_token:\s*accessToken/);
  assert.match(assessmentClientSource, /getOrCreateAssessmentAccessToken/);
  assert.match(assessmentClientSource, /loadAssessmentSession\([\s\S]*accessToken/);
  assert.match(assessmentClientSource, /submitVideoResponse\(submission, accessToken\)/);
  assert.doesNotMatch(supabaseClientSource, /\.from\(["']videos["']\)/);
  assert.doesNotMatch(supabaseClientSource, /\.from\(["']assessment_queue["']\)/);
  assert.doesNotMatch(componentAndLibSource, /has_lesion|lesion_onset_sec|hasLesion|lesionOnsetSec|detection_latency_ms/);
  assert.doesNotMatch(supabaseClientSource, /p_study_mode|NEXT_PUBLIC_STUDY_MODE|getStudyMode/);
});

test("stores a versioned high-entropy access token without logging it", () => {
  assert.match(supabaseClientSource, /assessment-access:v1:/);
  assert.match(supabaseClientSource, /crypto\.getRandomValues/);
  assert.match(supabaseClientSource, /localStorage\.setItem/);
  assert.match(supabaseClientSource, /localStorage\.getItem/);
  assert.doesNotMatch(supabaseClientSource, /console\.(?:log|warn|error)\([^)]*accessToken/s);
  assert.doesNotMatch(assessmentClientSource, /console\.(?:log|warn|error)\([^)]*accessToken/s);
});

test("captures ended time and repeated click indexes through refs before state", () => {
  const endedBody = getFunctionBody(assessmentClientSource, "handleVideoEnded");
  assertLexicalOrder(endedBody, [
    "videoEndedAtRef.current = endedAtMs;",
    "setVideoEnded(true);"
  ]);

  const detectBody = getFunctionBody(assessmentClientSource, "handleDetect");
  assertLexicalOrder(detectBody, [
    "const videoTimeSec = captureVideoTimeAtClick(videoRef.current);",
    "const nowMs = performance.now();",
    "const click = createLesionDetectionClick({"
  ]);
  assert.match(detectBody, /videoTimeSec,\s*nowMs,/);
  assert.equal(
    detectBody.match(/captureVideoTimeAtClick\(videoRef\.current\)/g)?.length,
    1
  );
  assertLexicalOrder(detectBody, [
    "clickIndex: detectionClicksRef.current.length + 1",
    "detectionClicksRef.current = nextClicks;",
    "setDetectionClicks(nextClicks);"
  ]);
});

test("builds no before clearing visible clicks and retries the same object", () => {
  const finalizeBody = getFunctionBody(assessmentClientSource, "finalizeVideo");
  assertLexicalOrder(finalizeBody, [
    "const submission = buildVideoSubmission(",
    "setPendingSubmission(submission);",
    'if (finalClassification === "no")',
    "detectionClicksRef.current = [];",
    "setDetectionClicks([]);",
    "void submitPendingSubmission(submission);"
  ]);

  const retryBody = getFunctionBody(assessmentClientSource, "retrySubmission");
  assert.match(retryBody, /submitPendingSubmission\(pendingSubmission\)/);
  assert.doesNotMatch(retryBody, /performance\.now|buildVideoSubmission/);
});

test("captures the no-response timestamp before SurveyJS validation", () => {
  const noBody = getFunctionBody(lesionSurveySource, "handleFinalizeNo");
  assertLexicalOrder(noBody, [
    "const noClickedAtMs = performance.now();",
    'validateFinalClassification("no")',
    "onFinalizeNo(noClickedAtMs);"
  ]);
  assert.match(assessmentClientSource, /onFinalizeNo=\{\(noClickedAtMs\) => finalizeVideo\("no", noClickedAtMs\)\}/);
  const finalizeBody = getFunctionBody(assessmentClientSource, "finalizeVideo");
  assert.match(finalizeBody, /nowMs: finalizedAtMs,/);
  assert.doesNotMatch(finalizeBody, /nowMs: performance\.now\(\)/);
});

test("uses six-hour private signed URLs without logging their secrets", () => {
  assert.match(supabaseClientSource, /SIGNED_URL_EXPIRY_SECONDS = 6 \* 60 \* 60/);
  assert.match(supabaseClientSource, /createSignedUrl\([^,]+, SIGNED_URL_EXPIRY_SECONDS\)/);
  const signedUrlLog = supabaseClientSource.match(
    /console\.log\("generated video URL", \{[\s\S]*?\n  \}\);/
  )?.[0];
  assert.ok(signedUrlLog, "Expected signed URL generation telemetry.");
  assert.doesNotMatch(signedUrlLog, /signedUrl/);
});

test("keeps SurveyJS as validation boundary while rendering custom controls", () => {
  assert.match(lesionSurveySource, /import \{ Model \} from "survey-core"/);
  assert.match(lesionSurveySource, /isRequired: true/);
  assert.match(lesionSurveySource, /survey\.validate\(/);
  assert.match(lesionSurveySource, />Lesion detected</);
  assert.match(lesionSurveySource, />No lesion detected</);
  assert.match(lesionSurveySource, />Next video</);
  assert.doesNotMatch(lesionSurveySource, /survey-react-ui|<Survey\b/);
});

test("removes every legacy direct response insert symbol", () => {
  assert.doesNotMatch(
    componentAndLibSource,
    new RegExp(staleSymbols.join("|"))
  );
});

test("wraps long error text inside the completion panel", () => {
  assert.match(
    globalStylesSource,
    /\.complete-panel h2\s*\{[^}]*overflow-wrap:\s*anywhere;/s
  );
});
