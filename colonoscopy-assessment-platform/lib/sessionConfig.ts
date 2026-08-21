export const STUDY_SESSION_NUMBERS = [1, 2, 3] as const;
export const FORMAL_VIDEOS_PER_SESSION = 40;

export type StudySessionNumber = (typeof STUDY_SESSION_NUMBERS)[number];
export type StudyMode = "dev" | "formal";

export function isStudySessionNumber(value: number): value is StudySessionNumber {
  return STUDY_SESSION_NUMBERS.includes(value as StudySessionNumber);
}

export function getStudyMode(): StudyMode {
  return process.env.NEXT_PUBLIC_STUDY_MODE === "formal" ? "formal" : "dev";
}
