export const STUDY_SESSION_NUMBERS = [1, 2, 3] as const;
export const FORMAL_VIDEOS_PER_SESSION = 40;

export type StudySessionNumber = (typeof STUDY_SESSION_NUMBERS)[number];
export type StudyMode = "dev" | "formal";

export function isStudySessionNumber(value: number): value is StudySessionNumber {
  return STUDY_SESSION_NUMBERS.includes(value as StudySessionNumber);
}

export function buildStartOrResumeRpcParams(
  participantId: string,
  sessionNumber: number
) {
  return {
    p_participant_id: participantId,
    p_session_number: sessionNumber
  };
}
