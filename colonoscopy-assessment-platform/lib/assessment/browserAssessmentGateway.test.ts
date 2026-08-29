import assert from "node:assert/strict";
import test from "node:test";
import type { VideoSubmission } from "../assessmentTypes.ts";
import { createLocalBrowserAssessmentGateway } from "./browserAssessmentGateway.ts";

const submission: VideoSubmission = {
  participant_id: "P001",
  session_number: 2,
  video_id: "formal_2_001",
  video_order: 1,
  final_answer: true,
  response_time_ms: 1200,
  no_response_latency_ms: null,
  video_completed: true,
  clicks: [
    {
      click_index: 1,
      video_time_at_click: 0.125,
      response_time_ms: 1200
    }
  ]
};

test("starts and resumes LOCAL attempts without participant-controlled mode", async () => {
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [];
  const fetcher: typeof fetch = async (input, init) => {
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    requests.push({ url: String(input), body });
    return Response.json({
      kind: "session",
      session: {
        attemptId: "attempt-001",
        participantId: "P001",
        sessionNumber: 2,
        status: "in_progress",
        queue: [
          { videoId: "formal_2_001", videoOrder: 1 },
          { videoId: "formal_2_002", videoOrder: 2 }
        ],
        nextVideoOrder: 2,
        isComplete: false
      }
    });
  };
  const gateway = createLocalBrowserAssessmentGateway(fetcher);
  const session = await gateway.startOrResume({
    participantId: "P001",
    sessionNumber: 2,
    attemptId: "attempt-001"
  });

  assert.deepEqual(requests, [
    {
      url: "/api/assessment/start",
      body: {
        participant_id: "P001",
        session_number: 2,
        attempt_id: "attempt-001"
      }
    }
  ]);
  assert.deepEqual(session, {
    attemptId: "attempt-001",
    videoQueue: [
      { videoId: "formal_2_001", videoOrder: 1 },
      { videoId: "formal_2_002", videoOrder: 2 }
    ],
    startIndex: 1,
    isComplete: false
  });
  assert.doesNotMatch(JSON.stringify(requests), /study|pool|test|lesion/i);
});

test("requests only the authorized LOCAL video URL", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const gateway = createLocalBrowserAssessmentGateway(async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({
      attemptId: "attempt-001",
      videoId: "formal_2_001",
      videoOrder: 1,
      url: "/api/local/attempts/attempt-001/videos/1",
      expiresAt: null
    });
  });

  const source = await gateway.loadCurrentVideo({
    attemptId: "attempt-001",
    participantId: "P001",
    sessionNumber: 2,
    video: { videoId: "formal_2_001", videoOrder: 1 }
  });

  assert.deepEqual(requests, [
    { attempt_id: "attempt-001", video_order: 1 }
  ]);
  assert.equal(source.playbackUrl, "/api/local/attempts/attempt-001/videos/1");
  assert.doesNotMatch(JSON.stringify(source), /\.mp4|file_path|lesion/i);
});

test("submits no identity, mode, path, or derived research fields", async () => {
  const requests: Array<Record<string, unknown>> = [];
  const gateway = createLocalBrowserAssessmentGateway(async (_input, init) => {
    requests.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({
      attemptId: "attempt-001",
      nextVideoOrder: 2,
      isComplete: false
    });
  });

  await gateway.submitResponse("attempt-001", submission);

  assert.deepEqual(requests, [
    {
      attempt_id: "attempt-001",
      video_order: 1,
      answer: true,
      response_time_ms: 1200,
      no_response_latency_ms: null,
      video_completed: true,
      clicks: submission.clicks
    }
  ]);
  assert.doesNotMatch(
    JSON.stringify(requests),
    /participant|session_number|video_id|study|pool|file|correct|detection_latency/i
  );
});

test("rejects attempt choices instead of selecting one in the browser", async () => {
  const gateway = createLocalBrowserAssessmentGateway(async () =>
    Response.json({
      kind: "attempt_choice_required",
      attempts: []
    })
  );

  await assert.rejects(
    () =>
      gateway.startOrResume({
        participantId: "P001",
        sessionNumber: 1
      }),
    /multiple in-progress attempts/i
  );
});
