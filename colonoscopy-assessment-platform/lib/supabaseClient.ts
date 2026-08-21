import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { VideoSubmission } from "@/lib/assessmentTypes";
import { buildSubmissionRpcParams } from "@/lib/lesionResponse";
import {
  buildStartOrResumeRpcParams,
  type StudyMode
} from "@/lib/sessionConfig";

const START_OR_RESUME_FUNCTION = "start_or_resume_assessment";
const SUBMIT_RESPONSE_FUNCTION = "submit_video_response";
const VIDEO_URL_FUNCTION = "issue-assessment-video-url";
const SIGNED_URL_EXPIRY_SECONDS = 6 * 60 * 60;

let client: SupabaseClient | null = null;

export type VideoQueueItem = {
  videoId: string;
  videoOrder: number;
};

export type VideoSource = VideoQueueItem & {
  signedUrl: string;
};

type SafeQueueRow = {
  video_id: string;
  video_order: number | string;
  next_video_order: number | string;
  queue_length: number | string;
  study_mode: string;
};

type SignedVideoResponse = {
  signed_url?: unknown;
  video_order?: unknown;
  expires_in_seconds?: unknown;
};

export type AssessmentSession = {
  videoQueue: VideoQueueItem[];
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

function requireSupabaseClient() {
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }

  return supabase;
}

function parsePositiveInteger(value: unknown, fieldName: string) {
  const parsed = Number(value);

  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Assessment service returned invalid ${fieldName}.`);
  }

  return parsed;
}

function parseStudyMode(value: string): StudyMode {
  if (value === "dev" || value === "formal") {
    return value;
  }

  throw new Error("Assessment service returned an invalid study mode.");
}

function parseSafeQueueRows(rows: SafeQueueRow[]) {
  if (rows.length === 0) {
    throw new Error("Assessment service returned an empty queue.");
  }

  const firstRow = rows[0];
  const queueLength = parsePositiveInteger(firstRow.queue_length, "queue_length");
  const nextVideoOrder = parsePositiveInteger(
    firstRow.next_video_order,
    "next_video_order"
  );
  const studyMode = parseStudyMode(firstRow.study_mode);

  if (rows.length !== queueLength || nextVideoOrder > queueLength + 1) {
    throw new Error("Assessment service returned an inconsistent queue.");
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
      Number(row.queue_length) !== queueLength ||
      Number(row.next_video_order) !== nextVideoOrder ||
      row.study_mode !== firstRow.study_mode ||
      !row.video_id
    ) {
      throw new Error("Assessment service returned an invalid queue row.");
    }

    return {
      videoId: row.video_id,
      videoOrder
    };
  });

  if (new Set(videoQueue.map((video) => video.videoId)).size !== videoQueue.length) {
    throw new Error("Assessment service returned duplicate video IDs.");
  }

  return { videoQueue, nextVideoOrder, queueLength, studyMode };
}

export async function loadAssessmentSession(
  participantId: string,
  sessionNumber: number,
  accessCode: string
): Promise<AssessmentSession> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.rpc(
    START_OR_RESUME_FUNCTION,
    buildStartOrResumeRpcParams(participantId, sessionNumber, accessCode)
  );

  if (error) {
    throw new Error(error.message);
  }

  const parsed = parseSafeQueueRows((data ?? []) as SafeQueueRow[]);
  const isComplete = parsed.nextVideoOrder === parsed.queueLength + 1;
  const startIndex = isComplete
    ? parsed.queueLength
    : parsed.nextVideoOrder - 1;

  console.log("fetched videos", {
    queue_length: parsed.queueLength,
    study_mode: parsed.studyMode
  });
  console.log("assessment resume status", {
    next_video_order: parsed.nextVideoOrder,
    queue_length: parsed.queueLength,
    study_mode: parsed.studyMode,
    is_complete: isComplete
  });

  return {
    videoQueue: parsed.videoQueue,
    startIndex,
    isComplete,
    studyMode: parsed.studyMode
  };
}

export async function loadCurrentVideoSource(
  participantId: string,
  sessionNumber: number,
  video: VideoQueueItem,
  accessCode: string
): Promise<VideoSource> {
  const supabase = requireSupabaseClient();
  const { data, error } = await supabase.functions.invoke(VIDEO_URL_FUNCTION, {
    body: {
      participant_id: participantId,
      session_number: sessionNumber,
      video_order: video.videoOrder,
      access_code: accessCode
    }
  });

  if (error) {
    throw new Error("Unable to authorize the current assessment video.");
  }

  const response = (data ?? {}) as SignedVideoResponse;
  const videoOrder = Number(response.video_order);
  const expiresInSeconds = Number(response.expires_in_seconds);

  if (
    typeof response.signed_url !== "string" ||
    response.signed_url.length === 0 ||
    videoOrder !== video.videoOrder ||
    expiresInSeconds !== SIGNED_URL_EXPIRY_SECONDS
  ) {
    throw new Error("Video authorization returned an invalid response.");
  }

  console.log("generated video URL", {
    video_id: video.videoId,
    video_order: video.videoOrder,
    expires_in_seconds: expiresInSeconds
  });

  return { ...video, signedUrl: response.signed_url };
}

export async function submitVideoResponse(
  submission: VideoSubmission,
  accessCode: string
) {
  const supabase = requireSupabaseClient();
  const result = await supabase.rpc(
    SUBMIT_RESPONSE_FUNCTION,
    buildSubmissionRpcParams(submission, accessCode)
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
