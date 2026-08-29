export type SessionNumber = 1 | 2 | 3;

export type ParticipantStartInput = {
  participantId: string;
  sessionNumber: SessionNumber;
  attemptId?: string;
};

export type AttemptQueueItem = {
  videoId: string;
  videoOrder: number;
};

export type AttemptStatus =
  | "in_progress"
  | "completed"
  | "abandoned"
  | "invalid";

export type AttemptSession = {
  attemptId: string;
  participantId: string;
  sessionNumber: SessionNumber;
  status: AttemptStatus;
  queue: readonly AttemptQueueItem[];
  nextVideoOrder: number;
  isComplete: boolean;
};

export type StartResult =
  | { kind: "session"; session: AttemptSession }
  | {
      kind: "attempt_choice_required";
      attempts: readonly AttemptSession[];
    };

export type AttemptDetectionClick = {
  clickIndex: number;
  videoTimeAtClick: number;
  responseTimeMs: number;
};

export type AttemptVideoSubmission = {
  attemptId: string;
  videoOrder: number;
  answer: boolean;
  responseTimeMs: number;
  noResponseLatencyMs: number | null;
  videoCompleted: true;
  clicks: readonly AttemptDetectionClick[];
};

export type SubmitResult = {
  attemptId: string;
  nextVideoOrder: number;
  isComplete: boolean;
};

export interface AssessmentRepository {
  createOrResumeAttempt(input: ParticipantStartInput): Promise<StartResult>;
  submitResponse(submission: AttemptVideoSubmission): Promise<SubmitResult>;
  markAttemptAbandoned(attemptId: string): Promise<void>;
}

export interface CurrentVideoAuthorizationRepository {
  authorizeCurrentVideo(
    attemptId: string,
    videoOrder: number
  ): Promise<{
    videoId: string;
    relativeFilePath: string;
  }>;
}

const PARTICIPANT_START_KEYS = new Set([
  "participant_id",
  "session_number",
  "attempt_id"
]);
const ATTEMPT_RESPONSE_KEYS = new Set([
  "attempt_id",
  "video_order",
  "answer",
  "response_time_ms",
  "no_response_latency_ms",
  "video_completed",
  "clicks"
]);
const DETECTION_CLICK_KEYS = new Set([
  "click_index",
  "video_time_at_click",
  "response_time_ms"
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseRequiredIdentifier(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }

  return value.trim();
}

function parseSessionNumber(value: unknown): SessionNumber {
  if (value === 1 || value === 2 || value === 3) {
    return value;
  }

  throw new Error("session_number must be 1, 2, or 3.");
}

function parsePositiveInteger(value: unknown, fieldName: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${fieldName} must be a positive integer.`);
  }

  return value as number;
}

function parseNonnegativeInteger(value: unknown, fieldName: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new Error(`${fieldName} must be a nonnegative integer.`);
  }

  return value as number;
}

function parseDetectionClick(
  value: unknown,
  expectedIndex: number
): AttemptDetectionClick {
  if (!isRecord(value)) {
    throw new Error("Lesion click must be an object.");
  }

  const unsupportedFields = Object.keys(value).filter(
    (key) => !DETECTION_CLICK_KEYS.has(key)
  );

  if (unsupportedFields.length > 0) {
    throw new Error("Lesion click contains unsupported fields.");
  }

  const clickIndex = parsePositiveInteger(value.click_index, "click_index");

  if (clickIndex !== expectedIndex) {
    throw new Error("click_index must be contiguous from 1.");
  }

  if (
    typeof value.video_time_at_click !== "number" ||
    !Number.isFinite(value.video_time_at_click) ||
    value.video_time_at_click < 0
  ) {
    throw new Error("video_time_at_click must be a nonnegative number.");
  }

  return {
    clickIndex,
    videoTimeAtClick: value.video_time_at_click,
    responseTimeMs: parseNonnegativeInteger(
      value.response_time_ms,
      "response_time_ms"
    )
  };
}

export function parseParticipantStartInput(
  payload: unknown
): ParticipantStartInput {
  if (!isRecord(payload)) {
    throw new Error("Participant start payload must be an object.");
  }

  const unsupportedFields = Object.keys(payload).filter(
    (key) => !PARTICIPANT_START_KEYS.has(key)
  );

  if (unsupportedFields.length > 0) {
    throw new Error("Participant start payload contains unsupported fields.");
  }

  const input: ParticipantStartInput = {
    participantId: parseRequiredIdentifier(
      payload.participant_id,
      "participant_id"
    ),
    sessionNumber: parseSessionNumber(payload.session_number)
  };

  if (Object.hasOwn(payload, "attempt_id")) {
    input.attemptId = parseRequiredIdentifier(payload.attempt_id, "attempt_id");
  }

  return input;
}

export function parseAttemptVideoSubmission(
  payload: unknown
): AttemptVideoSubmission {
  if (!isRecord(payload)) {
    throw new Error("Attempt response payload must be an object.");
  }

  const unsupportedFields = Object.keys(payload).filter(
    (key) => !ATTEMPT_RESPONSE_KEYS.has(key)
  );

  if (unsupportedFields.length > 0) {
    throw new Error("Attempt response payload contains unsupported fields.");
  }

  if (typeof payload.answer !== "boolean") {
    throw new Error("answer must be a boolean.");
  }

  if (payload.video_completed !== true) {
    throw new Error("video_completed must be true.");
  }

  if (!Array.isArray(payload.clicks)) {
    throw new Error("clicks must be an array.");
  }

  let noResponseLatencyMs: number | null;

  if (payload.no_response_latency_ms === null) {
    noResponseLatencyMs = null;
  } else {
    noResponseLatencyMs = parseNonnegativeInteger(
      payload.no_response_latency_ms,
      "no_response_latency_ms"
    );
  }

  return {
    attemptId: parseRequiredIdentifier(payload.attempt_id, "attempt_id"),
    videoOrder: parsePositiveInteger(payload.video_order, "video_order"),
    answer: payload.answer,
    responseTimeMs: parseNonnegativeInteger(
      payload.response_time_ms,
      "response_time_ms"
    ),
    noResponseLatencyMs,
    videoCompleted: true,
    clicks: payload.clicks.map((click, index) =>
      parseDetectionClick(click, index + 1)
    )
  };
}
