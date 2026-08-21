export const STUDY_SESSION_NUMBERS = [1, 2, 3] as const;
export const FORMAL_VIDEOS_PER_SESSION = 40;

export type StudySessionNumber = (typeof STUDY_SESSION_NUMBERS)[number];
export type StudyMode = "dev" | "formal";

type AssessmentAccessStorage = Pick<Storage, "getItem" | "setItem">;

export type AssessmentAccessTokenDependencies = {
  storage: AssessmentAccessStorage;
  getRandomValues: (bytes: Uint8Array) => Uint8Array;
};

const ACCESS_TOKEN_KEY_PREFIX = "assessment-access:v1:";
const ACCESS_TOKEN_MIN_LENGTH = 32;

export function isStudySessionNumber(value: number): value is StudySessionNumber {
  return STUDY_SESSION_NUMBERS.includes(value as StudySessionNumber);
}

function getBrowserAccessTokenDependencies(): AssessmentAccessTokenDependencies {
  if (typeof window === "undefined") {
    throw new Error("Assessment access tokens can only be created in the browser.");
  }

  const storage = window.localStorage;

  if (!window.crypto?.getRandomValues) {
    throw new Error("Secure browser randomness is unavailable.");
  }

  return {
    storage,
    getRandomValues: (bytes) => window.crypto.getRandomValues(bytes)
  };
}

function createAccessToken(
  dependencies: AssessmentAccessTokenDependencies
) {
  const bytes = new Uint8Array(32);
  dependencies.getRandomValues(bytes);

  return Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");
}

export function getOrCreateAssessmentAccessToken(
  participantId: string,
  sessionNumber: number,
  dependencies?: AssessmentAccessTokenDependencies
) {
  const resolvedDependencies =
    dependencies ?? getBrowserAccessTokenDependencies();
  const storageKey = `${ACCESS_TOKEN_KEY_PREFIX}${encodeURIComponent(participantId)}:${sessionNumber}`;
  const existingToken = resolvedDependencies.storage.getItem(storageKey);

  if (existingToken && existingToken.length >= ACCESS_TOKEN_MIN_LENGTH) {
    return existingToken;
  }

  const accessToken = createAccessToken(resolvedDependencies);
  resolvedDependencies.storage.setItem(storageKey, accessToken);

  return accessToken;
}

export function buildStartOrResumeRpcParams(
  participantId: string,
  sessionNumber: number,
  accessToken: string
) {
  return {
    p_participant_id: participantId,
    p_session_number: sessionNumber,
    p_access_token: accessToken
  };
}
