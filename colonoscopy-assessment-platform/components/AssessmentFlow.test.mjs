import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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
const sessionConfigSource = readFileSync(
  new URL("../lib/sessionConfig.ts", import.meta.url),
  "utf8"
);
const envExampleSource = readFileSync(
  new URL("../.env.example", import.meta.url),
  "utf8"
);
const edgeFunctionUrl = new URL(
  "../supabase/functions/issue-assessment-video-url/index.ts",
  import.meta.url
);
const edgeFunctionSource = existsSync(edgeFunctionUrl)
  ? readFileSync(edgeFunctionUrl, "utf8")
  : "";
const supabaseConfigUrl = new URL("../supabase/config.toml", import.meta.url);
const supabaseConfigSource = existsSync(supabaseConfigUrl)
  ? readFileSync(supabaseConfigUrl, "utf8")
  : "";
const componentAndLibSource = [
  assessmentClientSource,
  lesionSurveySource,
  assessmentTypesSource,
  supabaseClientSource,
  sessionConfigSource
].join("\n");
const staleSymbols = [
  ["insert", "Response"].join(""),
  ["Response", "Insert"].join(""),
  ["RESPONSE", "_INSERT_COLUMNS"].join(""),
  ["Response", "Type"].join(""),
  ["response", "LockedRef"].join(""),
  ["submitted", "Ref"].join("")
];
const staleStudyModePattern = new RegExp(
  [
    ["get", "StudyMode"].join(""),
    ["NEXT_PUBLIC", "_STUDY_MODE"].join("")
  ].join("|")
);

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

test("integrates the interactive player and atomic submission client", () => {
  assert.match(assessmentClientSource, /import AssessmentVideoPlayer/);
  assert.match(assessmentClientSource, /<AssessmentVideoPlayer/);
  assert.match(assessmentClientSource, /submitVideoResponse/);
  assert.doesNotMatch(assessmentClientSource, /<video\b/);
  assert.match(assessmentClientSource, /playbackUrl=\{signedVideoUrl\}/);
  assert.match(assessmentClientSource, /onDeleteMark=\{handleDeleteMark\}/);
});

test("uses the current access-code-free queue and response RPCs", () => {
  assert.match(supabaseClientSource, /start_or_resume_assessment/);
  assert.match(supabaseClientSource, /buildStartOrResumeRpcParams/);
  assert.doesNotMatch(componentAndLibSource, /accessCode|Access code|access_code/);
  assert.match(assessmentClientSource, /loadAssessmentSession\(\s*normalizedParticipantId,\s*parsedSessionNumber\s*\)/);
  assert.match(assessmentClientSource, /submitVideoResponse\(submission\)/);
  assert.doesNotMatch(supabaseClientSource, /\.from\(["']videos["']\)/);
  assert.doesNotMatch(supabaseClientSource, /\.from\(["']assessment_queue["']\)/);
  assert.doesNotMatch(componentAndLibSource, /has_lesion|lesion_onset_sec|hasLesion|lesionOnsetSec|detection_latency_ms/);
  assert.doesNotMatch(supabaseClientSource, /p_study_mode/);
  assert.doesNotMatch(supabaseClientSource, staleStudyModePattern);
});

test("keeps participant intake free of legacy access codes", () => {
  assert.doesNotMatch(sessionConfigSource, /localStorage|sessionStorage|getRandomValues/);
  assert.doesNotMatch(assessmentClientSource, /localStorage|sessionStorage|getRandomValues/);
  assert.doesNotMatch(componentAndLibSource, /access.?code/i);
  assert.match(
    assessmentClientSource,
    /requiresOnlinePassword[\s\S]*type="password"/
  );
  assert.doesNotMatch(edgeFunctionSource, /console\.(?:log|warn|error)/);
});

test("starts from participant ID and session only", () => {
  const startBody = getFunctionBody(assessmentClientSource, "startAssessment");

  assert.doesNotMatch(startBody, /accessCode|validateAssessmentAccessCode/);
  assert.match(startBody, /void loadQueue\(\)\.catch/);
  assert.match(startBody, /setIntakeError\(/);
});

test("keeps a rejected Supabase start on the intake screen", () => {
  const startBody = getFunctionBody(assessmentClientSource, "startAssessment");

  assert.match(startBody, /loadQueue\(\)\.catch/);
  assert.match(startBody, /setIntakeError\(/);
  assert.match(startBody, /setPhase\("intake"\);/);
});

test("removes the obsolete browser study-mode configuration", () => {
  assert.doesNotMatch(sessionConfigSource, staleStudyModePattern);
  assert.doesNotMatch(envExampleSource, staleStudyModePattern);
  assert.doesNotMatch(componentAndLibSource, staleStudyModePattern);
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

test("signs only the current video through the service-role Edge Function", () => {
  assert.match(supabaseClientSource, /issue-assessment-video-url/);
  assert.match(supabaseClientSource, /functions\.invoke/);
  assert.doesNotMatch(supabaseClientSource, /\.storage\b|createSignedUrl|Promise\.all/);
  assert.match(edgeFunctionSource, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(edgeFunctionSource, /authorize_current_assessment_video/);
  assert.match(edgeFunctionSource, /SIGNED_URL_EXPIRY_SECONDS = 6 \* 60 \* 60/);
  assert.match(edgeFunctionSource, /createSignedUrl/);
  assert.doesNotMatch(edgeFunctionSource, /\.list\(/);
  assert.doesNotMatch(edgeFunctionSource, /signed_url[^\n]*console|access_code[^\n]*console/i);
});

test("uses the current access-code-free authorization contract for the Edge Function", () => {
  assert.match(
    supabaseConfigSource,
    /\[functions\.issue-assessment-video-url\]\s*verify_jwt\s*=\s*false/s
  );
  assert.doesNotMatch(edgeFunctionSource, /accessCode\.length < 20/);
  assert.doesNotMatch(edgeFunctionSource, /p_access_code:|access_code/);
});

test("loads the server-authorized next video only after response commit", () => {
  const submitBody = getFunctionBody(assessmentClientSource, "submitPendingSubmission");

  assertLexicalOrder(submitBody, [
    "await submitVideoResponse(submission);",
    "await loadQueue();"
  ]);
});

test("keeps the locked video visible while loading the next signed URL", () => {
  const loadBody = getFunctionBody(assessmentClientSource, "loadQueue");

  assert.doesNotMatch(loadBody, /setSignedVideoUrl\(""\)/);
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
