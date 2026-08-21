export const STUDY_SESSION_NUMBERS = [1, 2, 3] as const;
export const FORMAL_VIDEOS_PER_SESSION = 40;

export type StudySessionNumber = (typeof STUDY_SESSION_NUMBERS)[number];
export type StudyMode = "dev" | "formal";
const ACCESS_CODE_MIN_LENGTH = 20;

export function isStudySessionNumber(value: number): value is StudySessionNumber {
  return STUDY_SESSION_NUMBERS.includes(value as StudySessionNumber);
}

export function validateAssessmentAccessCode(accessCode: string) {
  const normalized = accessCode.trim();

  if (normalized.length < ACCESS_CODE_MIN_LENGTH) {
    throw new Error("Study access code must contain at least 20 characters.");
  }

  return normalized;
}

export function buildStartOrResumeRpcParams(
  participantId: string,
  sessionNumber: number,
  accessCode: string
) {
  return {
    p_participant_id: participantId,
    p_session_number: sessionNumber,
    p_access_code: validateAssessmentAccessCode(accessCode)
  };
}
