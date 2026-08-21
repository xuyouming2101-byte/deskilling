import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { VideoSubmission } from "@/lib/assessmentTypes";
import { buildSubmissionRpcParams } from "@/lib/lesionResponse";
import type { StudyMode } from "@/lib/sessionConfig";

const START_OR_RESUME_FUNCTION = "start_or_resume_assessment";
const SUBMIT_RESPONSE_FUNCTION = "submit_video_response";
const SIGNED_URL_EXPIRY_SECONDS = 6 * 60 * 60;
const ACCESS_TOKEN_KEY_PREFIX = "assessment-access:v1:";
const ACCESS_TOKEN_MIN_LENGTH = 32;

let client: SupabaseClient | null = null;

export type VideoSource = {
  videoId: string;
  videoOrder: number;
  bucket: string;
  filePath: string;
  signedUrl: string;
};

type SafeQueueRow = {
  video_id: string;
  video_order: number | string;
  bucket: string;
  file_path: string;
  next_video_order: number | string;
  queue_length: number | string;
  study_mode: string;
};

export type AssessmentSession = {
  videoQueue: VideoSource[];
  startIndex: number;
  isComplete: boolean;
  studyMode: StudyMode;
};

export function isSupabaseConfigured() {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  );
}

export function getSupabaseClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabasePublishableKey =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!supabaseUrl || !supabasePublishableKey) {
    return null;
  }

  if (!client) {
    client = createClient(supabaseUrl, supabasePublishableKey, {
      auth: {
        autoRefreshToken: false,
        detectSessionInUrl: false,
        persistSession: false
      }
    });
  }

  return client;
}

function parsePositiveInteger(value: unknown, fieldName: string) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Assessment RPC returned invalid ${fieldName}.`);
  }

  return parsed;
}

function parseStudyMode(value: string): StudyMode {
  if (value === "dev" || value === "formal") {
    return value;
  }

  throw new Error("Assessment RPC returned an invalid study mode.");
}

function getAccessTokenStorageKey(participantId: string, sessionNumber: number) {
  return `${ACCESS_TOKEN_KEY_PREFIX}${encodeURIComponent(participantId)}:${sessionNumber}`;
}

function createAccessToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("");
}

export function getOrCreateAssessmentAccessToken(
  participantId: string,
  sessionNumber: number
) {
  if (typeof window === "undefined") {
    throw new Error("Assessment access tokens can only be created in the browser.");
  }

  const storageKey = getAccessTokenStorageKey(participantId, sessionNumber);
  const existingToken = window.localStorage.getItem(storageKey);

  if (existingToken && existingToken.length >= ACCESS_TOKEN_MIN_LENGTH) {
    return existingToken;
  }

  const accessToken = createAccessToken();
  window.localStorage.setItem(storageKey, accessToken);
  return accessToken;
}

function parseSafeQueueRows(rows: SafeQueueRow[]) {
  if (rows.length === 0) {
    throw new Error("Assessment RPC returned an empty queue.");
  }

  const firstRow = rows[0];
  const queueLength = parsePositiveInteger(firstRow.queue_length, "queue_length");
  const nextVideoOrder = parsePositiveInteger(
    firstRow.next_video_order,
    "next_video_order"
  );
  const studyMode = parseStudyMode(firstRow.study_mode);

  if (rows.length !== queueLength || nextVideoOrder > queueLength + 1) {
    throw new Error("Assessment RPC returned an inconsistent queue.");
  }

  const sortedRows = [...rows].sort(
    (left, right) =>
      parsePositiveInteger(left.video_order, "video_order") -
      parsePositiveInteger(right.video_order, "video_order")
  );

  const videoQueue = sortedRows.map((row, index) => {
    const videoOrder = parsePositiveInteger(row.video_order, "video_order");

    if (
      videoOrder !== index + 1 ||
      row.queue_length !== firstRow.queue_length ||
      row.next_video_order !== firstRow.next_video_order ||
      row.study_mode !== firstRow.study_mode ||
      !row.video_id ||
      !row.bucket ||
      !row.file_path
    ) {
      throw new Error("Assessment RPC returned an invalid queue row.");
    }

    return {
      videoId: row.video_id,
      videoOrder,
      bucket: row.bucket,
      filePath: row.file_path
    };
  });

  const videoIds = videoQueue.map((video) => video.videoId);

  if (new Set(videoIds).size !== videoIds.length) {
    throw new Error("Assessment RPC returned duplicate video IDs.");
  }

  return { videoQueue, nextVideoOrder, queueLength, studyMode };
}

async function createSignedVideoSource(
  supabase: SupabaseClient,
  video: Omit<VideoSource, "signedUrl">
): Promise<VideoSource> {
  const { data, error } = await supabase.storage
    .from(video.bucket)
    .createSignedUrl(video.filePath, SIGNED_URL_EXPIRY_SECONDS);

  if (error || !data?.signedUrl) {
    throw new Error(error?.message ?? `Unable to sign video ${video.videoId}.`);
  }

  console.log("generated video URL", {
    video_id: video.videoId,
    bucket: video.bucket,
    file_path: video.filePath,
    expires_in_seconds: SIGNED_URL_EXPIRY_SECONDS
  });

  return { ...video, signedUrl: data.signedUrl };
}

export async function loadAssessmentSession(
  participantId: string,
  sessionNumber: number,
  accessToken: string
): Promise<AssessmentSession> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }

  const { data, error } = await supabase.rpc(START_OR_RESUME_FUNCTION, {
    p_participant_id: participantId,
    p_session_number: sessionNumber,
    p_access_token: accessToken
  });

  if (error) {
    throw new Error(error.message);
  }

  const parsed = parseSafeQueueRows((data ?? []) as SafeQueueRow[]);
  console.log("fetched videos", {
    queue_length: parsed.queueLength,
    study_mode: parsed.studyMode
  });

  const videoQueue = await Promise.all(
    parsed.videoQueue.map((video) => createSignedVideoSource(supabase, video))
  );
  const isComplete = parsed.nextVideoOrder === parsed.queueLength + 1;
  const startIndex = isComplete
    ? parsed.queueLength
    : parsed.nextVideoOrder - 1;

  console.log("assessment resume status", {
    next_video_order: parsed.nextVideoOrder,
    queue_length: parsed.queueLength,
    study_mode: parsed.studyMode,
    is_complete: isComplete
  });

  return { videoQueue, startIndex, isComplete, studyMode: parsed.studyMode };
}

export async function submitVideoResponse(
  submission: VideoSubmission,
  accessToken: string
) {
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }

  const result = await supabase.rpc(
    SUBMIT_RESPONSE_FUNCTION,
    buildSubmissionRpcParams(submission, accessToken)
  );

  console.log("response insert result", {
    video_id: submission.video_id,
    video_order: submission.video_order,
    error: result.error?.message ?? null
  });

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result;
}
