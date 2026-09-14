import type { VideoSubmission } from "./assessmentTypes.ts";
import type { StudyMode } from "./sessionConfig.ts";

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


export function isAssessmentConfigured(online: boolean) {
  return online || Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
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


async function post(endpoint: string, body: object) {
  const response = await fetch(endpoint, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify(body), cache: "no-store"
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof result.error === "string" ? result.error : "Assessment service request failed.");
  return result;
}

export async function loadAssessmentSession(participantId: string, sessionNumber: number, viaServer = false): Promise<AssessmentSession> {
  if (!viaServer) return (await import("./supabaseClient")).loadAssessmentSession(participantId, sessionNumber);
  const result = await post("/api/assessment-session", { participant_id: participantId, session_number: sessionNumber });
  const parsed = parseSafeQueueRows((result.data ?? []) as SafeQueueRow[]);
  const isComplete = parsed.nextVideoOrder === parsed.queueLength + 1;
  return { videoQueue: parsed.videoQueue, startIndex: isComplete ? parsed.queueLength : parsed.nextVideoOrder - 1, isComplete, studyMode: parsed.studyMode };
}

export async function loadCurrentVideoSource(participantId: string, sessionNumber: number, video: VideoQueueItem, studyMode: StudyMode, viaServer = false): Promise<VideoSource> {
  if (!viaServer) return (await import("./supabaseClient")).loadCurrentVideoSource(participantId, sessionNumber, video, studyMode);
  const response = await post("/api/formal-video-url", { participant_id: participantId, session_number: sessionNumber, video_order: video.videoOrder }) as SignedVideoResponse;
  if (typeof response.signed_url !== "string" || !response.signed_url.startsWith("/api/formal-video?") ||
      Number(response.video_order) !== video.videoOrder || Number(response.expires_in_seconds) !== 21600) {
    throw new Error("Video authorization returned an invalid response.");
  }
  return { ...video, signedUrl: response.signed_url };
}

export async function submitVideoResponse(submission: VideoSubmission, viaServer = false) {
  if (!viaServer) return (await import("./supabaseClient")).submitVideoResponse(submission);
  const result = await post("/api/assessment-submit", submission);
  if (result.saved !== true) throw new Error("Unable to save response.");
  return { data: null, error: null };
}
