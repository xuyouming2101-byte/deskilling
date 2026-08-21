import type {
  LesionAnswer,
  LesionDetectionClick,
  VideoSubmission
} from "./assessmentTypes.ts";

type ClickArgs = {
  clickIndex: number;
  videoTimeSec: number;
  nowMs: number;
  playbackStartedAtMs: number;
  lesionOnsetSec: number | null;
};

type ActionStateArgs = {
  videoStarted: boolean;
  videoEnded: boolean;
  clickCount: number;
  locked: boolean;
};

type BuildSubmissionArgs = {
  participant_id: string;
  session_number: number;
  video_id: string;
  video_order: number;
  finalClassification: LesionAnswer;
  clicks: readonly LesionDetectionClick[];
  nowMs: number;
  playbackStartedAtMs: number;
  videoEndedAtMs: number;
};

const roundVideoSeconds = (value: number) =>
  Math.round(Math.max(0, value) * 1000) / 1000;

export function createLesionDetectionClick(
  args: ClickArgs
): LesionDetectionClick {
  const videoTimeAtClick = roundVideoSeconds(args.videoTimeSec);

  return {
    click_index: args.clickIndex,
    video_time_at_click: videoTimeAtClick,
    response_time_ms: Math.max(
      0,
      Math.round(args.nowMs - args.playbackStartedAtMs)
    ),
    detection_latency_ms:
      args.lesionOnsetSec === null
        ? null
        : Math.round((videoTimeAtClick - args.lesionOnsetSec) * 1000)
  };
}

export function getResponseActionState(args: ActionStateArgs) {
  if (!args.videoStarted || args.locked) {
    return {
      canDetect: false,
      canReportNoLesion: false,
      canGoNext: false
    };
  }

  return {
    canDetect: !args.videoEnded,
    canReportNoLesion: args.videoEnded,
    canGoNext: args.videoEnded && args.clickCount > 0
  };
}

export function buildVideoSubmission(
  args: BuildSubmissionArgs
): VideoSubmission {
  if (!Number.isFinite(args.videoEndedAtMs)) {
    throw new Error("A completed video requires an ended event timestamp.");
  }

  const firstClick = args.clicks[0] ?? null;

  if (args.finalClassification === "yes" && firstClick === null) {
    throw new Error("A positive response requires at least one lesion click.");
  }

  const isPositive = args.finalClassification === "yes";

  return {
    participant_id: args.participant_id,
    session_number: args.session_number,
    video_id: args.video_id,
    video_order: args.video_order,
    final_answer: isPositive,
    response_time_ms: isPositive
      ? firstClick!.response_time_ms
      : Math.max(0, Math.round(args.nowMs - args.playbackStartedAtMs)),
    summary_video_time_at_click: isPositive
      ? firstClick!.video_time_at_click
      : null,
    summary_detection_latency_ms: isPositive
      ? firstClick!.detection_latency_ms
      : null,
    no_response_latency_ms: isPositive
      ? null
      : Math.max(0, Math.round(args.nowMs - args.videoEndedAtMs)),
    video_completed: true,
    clicks: args.clicks.map((click) => ({ ...click }))
  };
}

export function buildSubmissionRpcParams(submission: VideoSubmission) {
  return {
    p_participant_id: submission.participant_id,
    p_session_number: submission.session_number,
    p_video_id: submission.video_id,
    p_video_order: submission.video_order,
    p_answer: submission.final_answer,
    p_response_time_ms: submission.response_time_ms,
    p_no_response_latency_ms: submission.no_response_latency_ms,
    p_video_completed: submission.video_completed,
    p_clicks: submission.clicks.map((click) => ({
      click_index: click.click_index,
      video_time_at_click: click.video_time_at_click,
      response_time_ms: click.response_time_ms
    }))
  };
}
