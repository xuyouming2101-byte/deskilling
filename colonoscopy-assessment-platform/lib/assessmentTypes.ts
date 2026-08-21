export type LesionAnswer = "yes" | "no";

export type LesionDetectionClick = {
  readonly click_index: number;
  readonly video_time_at_click: number;
  readonly response_time_ms: number;
};

export type VideoSubmission = {
  readonly participant_id: string;
  readonly session_number: number;
  readonly video_id: string;
  readonly video_order: number;
  readonly final_answer: boolean;
  readonly response_time_ms: number;
  readonly no_response_latency_ms: number | null;
  readonly video_completed: true;
  readonly clicks: readonly LesionDetectionClick[];
};
