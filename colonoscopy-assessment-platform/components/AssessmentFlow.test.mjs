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
const browserGatewaySource = readFileSync(
  new URL("../lib/assessment/browserAssessmentGateway.ts", import.meta.url),
  "utf8"
);
const pageSource = readFileSync(new URL("../app/page.tsx", import.meta.url), "utf8");
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

test("integrates the player through a source-neutral assessment gateway", () => {
  assert.match(assessmentClientSource, /import AssessmentVideoPlayer/);
  assert.match(assessmentClientSource, /<AssessmentVideoPlayer/);
  assert.match(assessmentClientSource, /createBrowserAssessmentGateway/);
  assert.match(assessmentClientSource, /gateway\.submitResponse/);
  assert.match(pageSource, /<AssessmentClient deploymentMode=\{deploymentMode\}/);
  assert.doesNotMatch(assessmentClientSource, /<video\b/);
});

test("uses one injectable shared assessment tree for LOCAL and ONLINE", () => {
  assert.match(assessmentClientSource, /gateway\?: BrowserAssessmentGateway/);
  assert.equal(assessmentClientSource.match(/<AssessmentVideoPlayer/g)?.length, 1);
  assert.equal(assessmentClientSource.match(/<LesionSurvey/g)?.length, 1);
  assert.equal(assessmentClientSource.match(/className="assessment-grid"/g)?.length, 1);
  assert.equal(assessmentClientSource.match(/className="complete-panel"/g)?.length, 3);
  assert.doesNotMatch(
    assessmentClientSource,
    /deploymentMode\s*===|deploymentMode\s*!==|LocalAssessmentClient|OnlineAssessmentClient/
  );
});

test("keeps the golden two-column intake shell without source-specific wording", () => {
  assert.match(assessmentClientSource, /<aside className="protocol-panel"/);
  assert.match(assessmentClientSource, />Eligible videos</);
  assert.match(assessmentClientSource, />Server controlled</);
  assert.match(assessmentClientSource, />Private study videos</);
  assert.match(assessmentClientSource, />Recorded securely</);
  assert.doesNotMatch(
    assessmentClientSource,
    /Supabase ready|Supabase not configured|Private Supabase Storage|public\.responses|SQLite/
  );
  assert.match(
    globalStylesSource,
    /\.intake-grid,\s*\.assessment-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 360px;/s
  );
  assert.match(
    globalStylesSource,
    /@media \(max-width: 920px\)[\s\S]*?\.protocol-panel\s*\{[^}]*order:\s*-1;/
  );
});

test("keeps LOCAL participant intake limited to ID and Session 1/2/3", () => {
  assert.match(assessmentClientSource, />Participant ID</);
  assert.match(assessmentClientSource, />Session number</);
  assert.doesNotMatch(
    assessmentClientSource,
    /Study access code|type="password"|SERVER CONTROLLED|Supabase ready|Supabase not configured|public\.responses|Private Supabase Storage/
  );
  assert.doesNotMatch(
    browserGatewaySource,
    /study_mode|session_pool|is_test|has_lesion|lesion_onset|correct|detection_latency/
  );
});

test("uses the safe queue RPC without a study access code", () => {
  assert.match(supabaseClientSource, /start_or_resume_assessment/);
  assert.match(supabaseClientSource, /buildStartOrResumeRpcParams/);
  assert.match(assessmentClientSource, /gateway\.startOrResume/);
  assert.match(assessmentClientSource, /gateway\.submitResponse/);
  assert.doesNotMatch(componentAndLibSource, /accessCode|access_code|Study access code/i);
  assert.doesNotMatch(assessmentClientSource, /type="password"/);
  assert.doesNotMatch(supabaseClientSource, /\.from\(["']videos["']\)/);
  assert.doesNotMatch(supabaseClientSource, /\.from\(["']assessment_queue["']\)/);
  assert.doesNotMatch(componentAndLibSource, /has_lesion|lesion_onset_sec|hasLesion|lesionOnsetSec|detection_latency_ms/);
  assert.doesNotMatch(supabaseClientSource, /p_study_mode/);
  assert.doesNotMatch(supabaseClientSource, staleStudyModePattern);
});

test("does not persist participant assessment state in browser storage", () => {
  assert.doesNotMatch(sessionConfigSource, /localStorage|sessionStorage|getRandomValues/);
  assert.doesNotMatch(assessmentClientSource, /localStorage|sessionStorage|getRandomValues/);
  assert.doesNotMatch(edgeFunctionSource, /console\.(?:log|warn|error)/);
});

test("loads the queue after validating participant and session", () => {
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

test("omits marks from no submissions before clearing the visible list", () => {
  const finalizeBody = getFunctionBody(assessmentClientSource, "finalizeVideo");
  assertLexicalOrder(finalizeBody, [
    'const clicksToSubmit = finalClassification === "no"',
    "const submission = buildVideoSubmission(",
    "clicks: clicksToSubmit,",
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

test("lets participants delete pending marks and confirms no when marks exist", () => {
  assert.match(lesionSurveySource, /onDeleteMark/);
  assert.match(lesionSurveySource, /aria-label=\{`Delete mark \$\{click\.click_index\}`\}/);
  assert.match(
    lesionSurveySource,
    /window\.confirm\("现有 marks 将不会被记录。是否继续？"\)/
  );
  assert.match(assessmentClientSource, /removeLesionDetectionClick/);
  assert.match(assessmentClientSource, /onDeleteMark=\{handleDeleteMark\}/);
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

test("uses the current-video authorization RPC from the publishable-key Edge Function", () => {
  assert.match(
    supabaseConfigSource,
    /\[functions\.issue-assessment-video-url\]\s*verify_jwt\s*=\s*false/s
  );
  assert.doesNotMatch(edgeFunctionSource, /accessCode|access_code/i);
  assert.match(edgeFunctionSource, /p_video_order: videoOrder/);
});

test("loads the server-authorized next video only after response commit", () => {
  const submitBody = getFunctionBody(assessmentClientSource, "submitPendingSubmission");

  assertLexicalOrder(submitBody, [
    "await gateway.submitResponse(currentAttemptId, submission);",
    "await loadQueue(currentAttemptId);"
  ]);
});

test("keeps the locked video visible while loading the next signed URL", () => {
  const loadBody = getFunctionBody(assessmentClientSource, "loadQueue");

  assert.doesNotMatch(loadBody, /setPlaybackUrl\(""\)/);
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
