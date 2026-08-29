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
