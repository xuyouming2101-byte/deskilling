import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
import { readFileSync } from "node:fs";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export%20{}"
      };
    }

    return nextResolve(specifier, context);
  }
});

const { parseAttemptVideoSubmission, parseParticipantStartInput } =
  await import("./contracts.ts");
const { createAssessmentRepository, createVideoAuthorizationRepository } =
  await import("./assessmentRepositoryFactory.ts");

const contractsSource = readFileSync(
  new URL("./contracts.ts", import.meta.url),
  "utf8"
);
const pageSource = readFileSync(
  new URL("../../app/page.tsx", import.meta.url),
  "utf8"
);

test("parses only participant ID, session number, and optional attempt ID", () => {
  assert.deepEqual(
    parseParticipantStartInput({
      participant_id: "  P001  ",
      session_number: 2,
      attempt_id: " attempt-002 "
    }),
    {
      participantId: "P001",
      sessionNumber: 2,
      attemptId: "attempt-002"
    }
  );

  assert.deepEqual(
    parseParticipantStartInput({
      participant_id: "P002",
      session_number: 1
    }),
    {
      participantId: "P002",
      sessionNumber: 1
    }
  );
});

test("rejects participant-controlled study mode, pool, and ground truth", () => {
  const forbiddenPayloads = [
    { studyMode: "formal" },
    { study_mode: "formal" },
    { is_test: false },
    { session_pool: 1 },
    { has_lesion: true },
    { lesion_onset_sec: 2.5 },
    { correct: true }
  ];

  for (const forbidden of forbiddenPayloads) {
    assert.throws(
      () =>
        parseParticipantStartInput({
          participant_id: "P001",
          session_number: 1,
          ...forbidden
        }),
      /Participant start payload contains unsupported fields/
    );
  }
});

test("rejects invalid participant start values", () => {
  for (const payload of [
    null,
    {},
    { participant_id: "", session_number: 1 },
    { participant_id: "P001", session_number: 0 },
    { participant_id: "P001", session_number: 4 },
    { participant_id: "P001", session_number: "1" },
    { participant_id: "P001", session_number: 1, attempt_id: "" }
  ]) {
    assert.throws(() => parseParticipantStartInput(payload));
  }
});

test("parses only the current attempt response and remaining marks", () => {
  assert.deepEqual(
    parseAttemptVideoSubmission({
      attempt_id: " attempt-001 ",
      video_order: 3,
      answer: true,
      response_time_ms: 4321,
      no_response_latency_ms: null,
      video_completed: true,
      clicks: [
        {
          click_index: 1,
          video_time_at_click: 1.234,
          response_time_ms: 1200
        },
        {
          click_index: 2,
          video_time_at_click: 3.456,
          response_time_ms: 3400
        }
      ]
    }),
    {
      attemptId: "attempt-001",
      videoOrder: 3,
      answer: true,
      responseTimeMs: 4321,
      noResponseLatencyMs: null,
      videoCompleted: true,
      clicks: [
        {
          clickIndex: 1,
          videoTimeAtClick: 1.234,
          responseTimeMs: 1200
        },
        {
          clickIndex: 2,
          videoTimeAtClick: 3.456,
          responseTimeMs: 3400
        }
      ]
    }
  );
});

test("rejects response fields controlled or derived outside the browser", () => {
  const base = {
    attempt_id: "attempt-001",
    video_order: 1,
    answer: false,
    response_time_ms: 5000,
    no_response_latency_ms: 400,
    video_completed: true,
    clicks: []
  };
  const forbiddenPayloads = [
    { participant_id: "P001" },
    { session_number: 1 },
    { study_mode: "formal" },
    { session_pool: 1 },
    { is_test: false },
    { has_lesion: true },
    { lesion_onset_sec: 2.5 },
    { correct: true },
    { detection_latency_ms: 100 }
  ];

  for (const forbidden of forbiddenPayloads) {
    assert.throws(
      () => parseAttemptVideoSubmission({ ...base, ...forbidden }),
      /Attempt response payload contains unsupported fields/
    );
  }

  assert.throws(
    () =>
      parseAttemptVideoSubmission({
        ...base,
        clicks: [
          {
            click_index: 1,
            video_time_at_click: 1,
            response_time_ms: 100,
            final_valid: true
          }
        ]
      }),
    /Lesion click contains unsupported fields/
  );
});

test("rejects malformed response values before repository access", () => {
  const base = {
    attempt_id: "attempt-001",
    video_order: 1,
    answer: false,
    response_time_ms: 5000,
    no_response_latency_ms: 400,
    video_completed: true,
    clicks: []
  };

  for (const payload of [
    null,
    { ...base, video_order: 0 },
    { ...base, answer: "no" },
    { ...base, response_time_ms: 1.5 },
    { ...base, no_response_latency_ms: -1 },
    { ...base, video_completed: false },
    { ...base, clicks: "none" },
    {
      ...base,
      clicks: [
        {
          click_index: 0,
          video_time_at_click: 1,
          response_time_ms: 100
        }
      ]
    },
    {
      ...base,
      clicks: [
        {
          click_index: 1,
          video_time_at_click: -0.1,
          response_time_ms: 100
        }
      ]
    }
  ]) {
    assert.throws(() => parseAttemptVideoSubmission(payload));
  }
});

test("keeps study mode and derived research fields out of shared submissions", () => {
  assert.doesNotMatch(
    contractsSource,
    /studyMode|study_mode|is_test|session_pool|correct|lesionOnset|lesion_onset|detectionLatency|detection_latency/
  );
});

test("selects repositories only for the explicit deployment mode", () => {
  const createAssessmentDouble = (name: string) => ({
    name,
    async createOrResumeAttempt() {
      throw new Error("not used");
    },
    async submitResponse() {
      throw new Error("not used");
    },
    async markAttemptAbandoned() {}
  });
  const createVideoDouble = (name: string) => ({
    name,
    async authorizeCurrentVideo() {
      throw new Error("not used");
    }
  });
  const localAssessment = createAssessmentDouble("local-assessment");
  const onlineAssessment = createAssessmentDouble("online-assessment");
  const localVideo = createVideoDouble("local-video");
  const onlineVideo = createVideoDouble("online-video");

  assert.equal(
    createAssessmentRepository("local", {
      local: localAssessment,
      online: onlineAssessment
    }),
    localAssessment
  );
  assert.equal(
    createAssessmentRepository("online", {
      local: localAssessment,
      online: onlineAssessment
    }),
    onlineAssessment
  );
  assert.equal(
    createVideoAuthorizationRepository("local", {
      local: localVideo,
      online: onlineVideo
    }),
    localVideo
  );
  assert.throws(
    () => createAssessmentRepository("local", { online: onlineAssessment }),
    /No assessment repository is configured for local mode/
  );
});

test("rechecks the server deployment mode at the page boundary", () => {
  assert.match(pageSource, /export const dynamic = "force-dynamic"/);
  assert.match(pageSource, /readDeploymentMode\(\)/);
  assert.match(
    pageSource,
    /<AssessmentClient[\s\S]*deploymentMode=\{deploymentMode\}/
  );
  assert.doesNotMatch(pageSource, /NEXT_PUBLIC_ASSESSMENT_DEPLOYMENT_MODE/);
});
