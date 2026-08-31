import assert from "node:assert/strict";
import test from "node:test";
import {
  buildSubmissionRpcParams,
  buildVideoSubmission,
  createLesionDetectionClick,
  getResponseActionState
} from "./lesionResponse.ts";

const identity = {
  participant_id: "P001",
  session_number: 1,
  video_id: "video_001",
  video_order: 1
};

test("records repeated clicks with independent media and performance timing", () => {
  const first = createLesionDetectionClick({
    clickIndex: 1,
    videoTimeSec: 2.1254,
    nowMs: 5_100.4,
    playbackStartedAtMs: 1_000
  });
  const second = createLesionDetectionClick({
    clickIndex: 2,
    videoTimeSec: 4.5,
    nowMs: 7_000,
    playbackStartedAtMs: 1_000
  });

  assert.deepEqual(first, {
    click_index: 1,
    video_time_at_click: 2.125,
    response_time_ms: 4_100
  });
  assert.equal(second.click_index, 2);
  assert.deepEqual(Object.keys(second).sort(), [
    "click_index",
    "response_time_ms",
    "video_time_at_click"
  ]);
});

test("keeps lesion detection available during replay after the video ends", () => {
  assert.deepEqual(
    getResponseActionState({
      videoStarted: true,
      videoEnded: false,
      clickCount: 2,
      locked: false
    }),
    { canDetect: true, canReportNoLesion: false, canGoNext: false }
  );
  assert.deepEqual(
    getResponseActionState({
      videoStarted: true,
      videoEnded: true,
      clickCount: 2,
      locked: false
    }),
    { canDetect: true, canReportNoLesion: true, canGoNext: true }
  );
  assert.deepEqual(
    getResponseActionState({
      videoStarted: true,
      videoEnded: true,
      clickCount: 0,
      locked: false
    }),
    { canDetect: true, canReportNoLesion: true, canGoNext: false }
  );
});

test("disables every action before playback starts", () => {
  assert.deepEqual(
    getResponseActionState({
      videoStarted: false,
      videoEnded: false,
      clickCount: 0,
      locked: false
    }),
    { canDetect: false, canReportNoLesion: false, canGoNext: false }
  );
});

test("disables every action while the response is locked", () => {
  assert.deepEqual(
    getResponseActionState({
      videoStarted: true,
      videoEnded: true,
      clickCount: 2,
      locked: true
    }),
    { canDetect: false, canReportNoLesion: false, canGoNext: false }
  );
});

test("positive summary uses the first valid lesion click", () => {
  const submission = buildVideoSubmission({
    ...identity,
    finalClassification: "yes",
    clicks: [
      {
        click_index: 1,
        video_time_at_click: 2.125,
        response_time_ms: 4_100
      },
      {
        click_index: 2,
        video_time_at_click: 4.5,
        response_time_ms: 6_000
      }
    ],
    nowMs: 8_000,
    playbackStartedAtMs: 1_000,
    videoEndedAtMs: 7_500
  });

  assert.equal(submission.final_answer, true);
  assert.equal(submission.response_time_ms, 4_100);
  assert.equal(submission.no_response_latency_ms, null);
  assert.equal(submission.clicks.length, 2);
});

test("negative summary has no detection time and excludes overridden clicks", () => {
  const rawClick = {
    click_index: 1,
    video_time_at_click: 2.125,
    response_time_ms: 4_100
  };
  const submission = buildVideoSubmission({
    ...identity,
    finalClassification: "no",
    clicks: [rawClick],
    nowMs: 9_125.4,
    playbackStartedAtMs: 1_000,
    videoEndedAtMs: 8_000
  });

  assert.equal(submission.final_answer, false);
  assert.equal(submission.response_time_ms, 8_125);
  assert.equal(submission.no_response_latency_ms, 1_125);
  assert.deepEqual(submission.clicks, []);
});

test("builds a deeply immutable pending submission snapshot", () => {
  const rawClicks = [
    {
      click_index: 1,
      video_time_at_click: 2.125,
      response_time_ms: 4_100
    }
  ];
  const submission = buildVideoSubmission({
    ...identity,
    finalClassification: "yes",
    clicks: rawClicks,
    nowMs: 9_125,
    playbackStartedAtMs: 1_000,
    videoEndedAtMs: 8_000
  });

  rawClicks.length = 0;

  assert.equal(submission.clicks.length, 1);
  assert.equal(Object.isFrozen(submission), true);
  assert.equal(Object.isFrozen(submission.clicks), true);
  assert.equal(Object.isFrozen(submission.clicks[0]), true);
});

test("rejects a positive final classification without lesion clicks", () => {
  assert.throws(
    () =>
      buildVideoSubmission({
        ...identity,
        finalClassification: "yes",
        clicks: [],
        nowMs: 9_000,
        playbackStartedAtMs: 1_000,
        videoEndedAtMs: 8_000
      }),
    /requires at least one lesion click/
  );
});

test("maps a final submission and access code to the exact RPC parameter contract", () => {
  const params = buildSubmissionRpcParams({
    ...identity,
    final_answer: false,
    response_time_ms: 8_125,
    no_response_latency_ms: 1_125,
    video_completed: true,
    clicks: [
      {
        click_index: 1,
        video_time_at_click: 2.125,
        response_time_ms: 4_100
      }
    ]
  }, "coordinator-access-code-that-is-long-enough");

  assert.deepEqual(params, {
    p_participant_id: "P001",
    p_session_number: 1,
    p_video_id: "video_001",
    p_video_order: 1,
    p_answer: false,
    p_response_time_ms: 8_125,
    p_no_response_latency_ms: 1_125,
    p_video_completed: true,
    p_access_code: "coordinator-access-code-that-is-long-enough",
    p_clicks: []
  });
});

test("maps an identical submission and access code to identical retry parameters", () => {
  const submission = buildVideoSubmission({
    ...identity,
    finalClassification: "no",
    clicks: [],
    nowMs: 9_125,
    playbackStartedAtMs: 1_000,
    videoEndedAtMs: 8_000
  });
  const accessCode = "one-fixed-coordinator-code-for-every-retry";

  const firstAttempt = buildSubmissionRpcParams(submission, accessCode);
  const retryAttempt = buildSubmissionRpcParams(submission, accessCode);

  assert.deepEqual(retryAttempt, firstAttempt);
  assert.deepEqual(retryAttempt, {
    p_participant_id: "P001",
    p_session_number: 1,
    p_video_id: "video_001",
    p_video_order: 1,
    p_answer: false,
    p_response_time_ms: 8_125,
    p_no_response_latency_ms: 1_125,
    p_video_completed: true,
    p_access_code: "one-fixed-coordinator-code-for-every-retry",
    p_clicks: []
  });
});
