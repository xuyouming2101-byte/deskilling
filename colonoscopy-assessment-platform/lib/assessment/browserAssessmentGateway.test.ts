import assert from "node:assert/strict";
import test from "node:test";
import type { VideoSubmission } from "../assessmentTypes.ts";
import { createLocalBrowserAssessmentGateway } from "./browserAssessmentGateway.ts";

const originalEnvironment = {
  url: process.env.NEXT_PUBLIC_SUPABASE_URL,
  key: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  videoRoot: process.env.LOCAL_VIDEO_ROOT
};

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "publishable-key";
process.env.LOCAL_VIDEO_ROOT = "/tmp/videos";

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
  const calls: Array<[string, number]> = [];
  const dataSource = {
    async loadAssessmentSession(participantId: string, sessionNumber: number) {
      calls.push([participantId, sessionNumber]);
      return {
        videoQueue: [
          { videoId: "formal_2_001", videoOrder: 1 },
          { videoId: "formal_2_002", videoOrder: 2 }
        ],
        startIndex: 1,
        isComplete: false,
        studyMode: "formal" as const
      };
    },
    async submitVideoResponse() {
      return { error: null } as never;
    }
  };
  const gateway = createLocalBrowserAssessmentGateway(fetch, dataSource);
  const session = await gateway.startOrResume({
    participantId: "P001",
    sessionNumber: 2,
    attemptId: "attempt-001"
  });

  assert.deepEqual(calls, [["P001", 2]]);
  assert.equal(session.attemptId, "supabase:P001:2");
  assert.deepEqual(session.videoQueue, [
    { videoId: "formal_2_001", videoOrder: 1 },
    { videoId: "formal_2_002", videoOrder: 2 }
  ]);
  assert.equal(session.startIndex, 1);
  assert.equal(session.isComplete, false);
  assert.doesNotMatch(JSON.stringify(session), /study|pool|test|lesion/i);
});

test("uses the local MP4 route while Supabase supplies assessment state", async () => {
  const gateway = createLocalBrowserAssessmentGateway(fetch, {
    async loadAssessmentSession() {
      throw new Error("not used");
    },
    async submitVideoResponse() {
      throw new Error("not used");
    }
  });

  const source = await gateway.loadCurrentVideo({
    attemptId: "supabase:P001:2",
    participantId: "P001",
    sessionNumber: 2,
    video: { videoId: "formal_2_001", videoOrder: 1 }
  });

  assert.equal(
    source.playbackUrl,
    "/api/local/supabase-videos/supabase%3AP001%3A2/videos/1"
  );
  assert.doesNotMatch(JSON.stringify(source), /\.mp4|file_path|signed/i);
});

test("submits LOCAL responses to Supabase instead of SQLite", async () => {
  const submissions: VideoSubmission[] = [];
  const gateway = createLocalBrowserAssessmentGateway(fetch, {
    async loadAssessmentSession() {
      throw new Error("not used");
    },
    async submitVideoResponse(value) {
      submissions.push(value);
      return { error: null } as never;
    }
  });

  const result = await gateway.submitResponse("supabase:P001:2", submission);

  assert.deepEqual(submissions, [submission]);
  assert.deepEqual(result, { nextVideoOrder: 2, isComplete: false });
});

test("reports missing Supabase or local video configuration", () => {
  const previousKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  try {
    assert.equal(createLocalBrowserAssessmentGateway().isConfigured, false);
  } finally {
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = previousKey;
  }
});

test.after(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = originalEnvironment.url;
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = originalEnvironment.key;
  process.env.LOCAL_VIDEO_ROOT = originalEnvironment.videoRoot;
});

/*
 * The old SQLite gateway tests intentionally remain represented by the
 * dedicated LOCAL SQLite API tests; the normal browser path above is now
 * Supabase-backed and local-video-only.
 */
