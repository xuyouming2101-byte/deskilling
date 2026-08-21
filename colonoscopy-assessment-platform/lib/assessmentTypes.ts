export type LesionAnswer = "yes" | "no";

export type LesionDetectionClick = {
  click_index: number;
  video_time_at_click: number;
  response_time_ms: number;
  detection_latency_ms: number | null;
};

export type VideoSubmission = {
  participant_id: string;
  session_number: number;
  video_id: string;
  video_order: number;
  final_answer: boolean;
  response_time_ms: number;
  summary_video_time_at_click: number | null;
  summary_detection_latency_ms: number | null;
  no_response_latency_ms: number | null;
  video_completed: true;
  clicks: readonly LesionDetectionClick[];
};

export type ResponseType = "lesion_detected" | "no_lesion_detected";

export const RESPONSE_INSERT_COLUMNS = [
  "participant_id",
  "session_number",
  "video_id",
  "video_order",
  "answer",
  "correct",
  "response_time_ms",
  "video_time_at_click",
  "detection_latency_ms",
  "response_type",
  "video_completed"
] as const;

export type ResponseInsert = {
  participant_id: string;
  session_number: number;
  video_id: string;
  video_order: number;
  answer: LesionAnswer;
  correct: boolean;
  response_type: ResponseType;
  response_time_ms: number;
  video_time_at_click: number;
  detection_latency_ms: number | null;
  video_completed: boolean;
};
