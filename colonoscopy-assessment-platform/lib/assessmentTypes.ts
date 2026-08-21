export type LesionAnswer = "yes" | "no";

export type LesionDetectionClick = {
  readonly click_index: number;
  readonly video_time_at_click: number;
  readonly response_time_ms: number;
  readonly detection_latency_ms: number | null;
};

export type VideoSubmission = {
  readonly participant_id: string;
  readonly session_number: number;
  readonly video_id: string;
  readonly video_order: number;
  readonly final_answer: boolean;
  readonly response_time_ms: number;
  readonly summary_video_time_at_click: number | null;
  readonly summary_detection_latency_ms: number | null;
  readonly no_response_latency_ms: number | null;
  readonly video_completed: true;
  readonly clicks: readonly LesionDetectionClick[];
};
