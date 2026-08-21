import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { VideoSubmission } from "@/lib/assessmentTypes";
import { buildSubmissionRpcParams } from "@/lib/lesionResponse";
import { shuffleItems } from "@/lib/randomize";
import {
  FORMAL_VIDEOS_PER_SESSION,
  getStudyMode,
  type StudyMode
} from "@/lib/sessionConfig";

const QUEUE_TABLE_NAME = "assessment_queue";
const NEXT_VIDEO_ORDER_FUNCTION = "get_next_video_order";

let client: SupabaseClient | null = null;

export type VideoSource = {
  videoId: string;
  videoOrder: number;
  bucket: string;
  filePath: string;
  signedUrl: string;
  hasLesion: boolean;
  lesionOnsetSec: number | null;
};

export type VideoRow = {
  video_id: string;
  bucket: string | null;
  file_path: string | null;
  has_lesion: boolean | null;
  lesion_onset_sec?: number | string | null;
  is_test: boolean | null;
  session_pool: number | string | null;
};

type VideoRowFilters = {
  videoIds?: string[];
  isTest?: boolean;
  sessionPool?: number;
};

export type AssessmentQueueRow = {
  participant_id: string;
  session_number: number | string;
  video_id: string;
  video_order: number | string;
};

export type AssessmentSession = {
  videoQueue: VideoSource[];
  startIndex: number;
  completedVideoOrders: number[];
  isComplete: boolean;
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

export async function submitVideoResponse(submission: VideoSubmission) {
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }

  const params = buildSubmissionRpcParams(submission);
  console.log("submit_video_response payload", params);
  const result = await supabase.rpc("submit_video_response", params);
  console.log("submit_video_response result", result);

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result;
}

async function fetchVideoRows(
  supabase: SupabaseClient,
  filters: VideoRowFilters = {}
) {
  let withOnsetQuery = supabase
    .from("videos")
    .select(
      "video_id,bucket,file_path,has_lesion,lesion_onset_sec,is_test,session_pool"
    );

  if (filters.videoIds) {
    withOnsetQuery = withOnsetQuery.in("video_id", filters.videoIds);
  }

  if (filters.isTest !== undefined) {
    withOnsetQuery = withOnsetQuery.eq("is_test", filters.isTest);
  }

  if (filters.sessionPool !== undefined) {
    withOnsetQuery = withOnsetQuery.eq("session_pool", filters.sessionPool);
  }

  const withOnset = await withOnsetQuery;

  if (
    withOnset.error &&
    withOnset.error.message.toLowerCase().includes("lesion_onset_sec")
  ) {
    console.warn(
      "videos.lesion_onset_sec is not available; detection_latency_ms will be null."
    );

    let fallbackQuery = supabase
      .from("videos")
      .select("video_id,bucket,file_path,has_lesion,is_test,session_pool");

    if (filters.videoIds) {
      fallbackQuery = fallbackQuery.in("video_id", filters.videoIds);
    }

    if (filters.isTest !== undefined) {
      fallbackQuery = fallbackQuery.eq("is_test", filters.isTest);
    }

    if (filters.sessionPool !== undefined) {
      fallbackQuery = fallbackQuery.eq("session_pool", filters.sessionPool);
    }

    return fallbackQuery;
  }

  return withOnset;
}

function parseOptionalSeconds(value: VideoRow["lesion_onset_sec"]) {
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const numericValue = Number(value);

  return Number.isFinite(numericValue) ? numericValue : null;
}

function parseQueueOrder(value: AssessmentQueueRow["video_order"]) {
  const numericValue = Number(value);

  if (!Number.isInteger(numericValue) || numericValue < 1) {
    throw new Error(`assessment_queue has invalid video_order: ${value}.`);
  }

  return numericValue;
}

function parseSessionPool(value: VideoRow["session_pool"]) {
  const numericValue = Number(value);

  return Number.isInteger(numericValue) ? numericValue : null;
}

function getVideoPoolMismatch(row: VideoRow, mode: StudyMode, sessionNumber: number) {
  if (mode === "dev") {
    return row.is_test === true ? null : "not marked as a test video";
  }

  if (row.is_test !== false) {
    return "marked as a test video";
  }

  return parseSessionPool(row.session_pool) === sessionNumber
    ? null
    : `assigned to session_pool ${String(row.session_pool)}`;
}

function formatFormalReadinessError(sessionNumber: number, configuredCount: number) {
  return `Session ${sessionNumber} is not ready: ${configuredCount}/${FORMAL_VIDEOS_PER_SESSION} formal videos configured.`;
}

function validateVideoRowsForStudyMode(
  rows: VideoRow[],
  mode: StudyMode,
  sessionNumber: number,
  context: "eligible pool" | "persisted queue"
) {
  const mismatches = rows
    .map((row) => ({
      row,
      reason: getVideoPoolMismatch(row, mode, sessionNumber)
    }))
    .filter(
      (entry): entry is { row: VideoRow; reason: string } =>
        entry.reason !== null
    );

  if (mismatches.length > 0) {
    throw new Error(
      [
        `${context} contains videos outside ${mode.toUpperCase()} Session ${sessionNumber}.`,
        mismatches
          .slice(0, 5)
          .map((entry) => `${entry.row.video_id}: ${entry.reason}`)
          .join("; ")
      ].join(" ")
    );
  }
}

function validateEligibleVideoRows(
  rows: VideoRow[],
  mode: StudyMode,
  sessionNumber: number
) {
  const sortedRows = [...rows].sort((left, right) =>
    left.video_id.localeCompare(right.video_id, undefined, {
      numeric: true,
      sensitivity: "base"
    })
  );

  if (sortedRows.length === 0) {
    if (mode === "formal") {
      throw new Error(formatFormalReadinessError(sessionNumber, 0));
    }

    throw new Error("DEV MODE is not ready: 0 test videos configured.");
  }

  const actualVideoIds = sortedRows.map((row) => row.video_id);
  const duplicateVideoIds = actualVideoIds.filter(
    (videoId, index) => actualVideoIds.indexOf(videoId) !== index
  );

  if (duplicateVideoIds.length > 0) {
    throw new Error(
      `videos table returned duplicate video_id values: ${duplicateVideoIds.join(", ")}.`
    );
  }

  validateVideoRowsForStudyMode(
    sortedRows,
    mode,
    sessionNumber,
    "eligible pool"
  );

  if (mode === "formal" && sortedRows.length !== FORMAL_VIDEOS_PER_SESSION) {
    throw new Error(formatFormalReadinessError(sessionNumber, sortedRows.length));
  }

  return sortedRows;
}

function validateQueueRows(rows: AssessmentQueueRow[]) {
  if (rows.length === 0) {
    throw new Error("assessment_queue returned 0 rows.");
  }

  const sortedRows = [...rows].sort(
    (left, right) => parseQueueOrder(left.video_order) - parseQueueOrder(right.video_order)
  );
  const actualOrders = sortedRows.map((row) => parseQueueOrder(row.video_order));
  const actualVideoIds = sortedRows.map((row) => row.video_id);
  const duplicateOrders = actualOrders.filter(
    (order, index) => actualOrders.indexOf(order) !== index
  );
  const duplicateVideoIds = actualVideoIds.filter(
    (videoId, index) => actualVideoIds.indexOf(videoId) !== index
  );
  const missingOrders = Array.from(
    { length: sortedRows.length },
    (_, index) => index + 1
  ).filter((order) => !actualOrders.includes(order));
  const extraOrders = actualOrders.filter(
    (order) => order > sortedRows.length
  );

  if (
    duplicateOrders.length > 0 ||
    duplicateVideoIds.length > 0 ||
    missingOrders.length > 0 ||
    extraOrders.length > 0
  ) {
    throw new Error(
      [
        "assessment_queue rows are not a complete persisted video order.",
        duplicateOrders.length ? `Duplicate orders: ${duplicateOrders.join(", ")}` : "",
        duplicateVideoIds.length
          ? `Duplicate videos: ${duplicateVideoIds.join(", ")}`
          : "",
        missingOrders.length ? `Missing orders: ${missingOrders.join(", ")}` : "",
        extraOrders.length ? `Out-of-range orders: ${extraOrders.join(", ")}` : ""
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  return sortedRows;
}

async function fetchAssessmentQueueRows(
  supabase: SupabaseClient,
  participantId: string,
  sessionNumber: number
) {
  const { data, error } = await supabase
    .from(QUEUE_TABLE_NAME)
    .select("participant_id,session_number,video_id,video_order")
    .eq("participant_id", participantId)
    .eq("session_number", sessionNumber)
    .order("video_order", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []) as AssessmentQueueRow[];
}

async function fetchEligibleVideoRowsForSession(
  supabase: SupabaseClient,
  sessionNumber: number,
  mode: StudyMode
) {
  const videoResult = await fetchVideoRows(
    supabase,
    mode === "dev"
      ? { isTest: true }
      : { isTest: false, sessionPool: sessionNumber }
  );

  console.log("session video pool", {
    sessionNumber,
    mode,
    source:
      mode === "dev"
        ? "videos.is_test = true"
        : `videos.is_test = false and session_pool = ${sessionNumber}`,
    selectedVideoCount: videoResult.data?.length ?? null
  });

  return videoResult;
}

async function fetchValidatedEligibleVideoRowsForSession(
  supabase: SupabaseClient,
  sessionNumber: number,
  mode: StudyMode
) {
  const {
    data: videoRows,
    error: videoError
  } = await fetchEligibleVideoRowsForSession(supabase, sessionNumber, mode);

  if (videoError) {
    throw new Error(videoError.message);
  }

  return validateEligibleVideoRows(
    (videoRows ?? []) as VideoRow[],
    mode,
    sessionNumber
  );
}

function parseNextVideoOrderResult(value: unknown, queueLength: number) {
  let rawValue = value;
  const completionVideoOrder = queueLength + 1;

  if (Array.isArray(rawValue)) {
    if (rawValue.length !== 1) {
      throw new Error(
        `${NEXT_VIDEO_ORDER_FUNCTION} returned ${rawValue.length} rows; expected one scalar value.`
      );
    }

    rawValue = rawValue[0];
  }

  if (rawValue !== null && typeof rawValue === "object") {
    const record = rawValue as Record<string, unknown>;

    if (NEXT_VIDEO_ORDER_FUNCTION in record) {
      rawValue = record[NEXT_VIDEO_ORDER_FUNCTION];
    } else if ("next_video_order" in record) {
      rawValue = record.next_video_order;
    }
  }

  const numericValue = Number(rawValue);

  if (
    !Number.isInteger(numericValue) ||
    numericValue < 1 ||
    numericValue > completionVideoOrder
  ) {
    throw new Error(
      `${NEXT_VIDEO_ORDER_FUNCTION} returned invalid video_order: ${String(
        rawValue
      )}; expected 1 through ${completionVideoOrder}.`
    );
  }

  return numericValue;
}

async function fetchNextVideoOrder(
  supabase: SupabaseClient,
  participantId: string,
  sessionNumber: number,
  queueLength: number
) {
  const { data, error } = await supabase.rpc(NEXT_VIDEO_ORDER_FUNCTION, {
    p_participant_id: participantId,
    p_session_number: sessionNumber
  });

  console.log("get_next_video_order result", { data, error });

  if (error) {
    throw new Error(error.message);
  }

  return parseNextVideoOrderResult(data, queueLength);
}

async function createAssessmentQueueRows(
  supabase: SupabaseClient,
  participantId: string,
  sessionNumber: number,
  mode: StudyMode
) {
  const eligibleVideos = await fetchValidatedEligibleVideoRowsForSession(
    supabase,
    sessionNumber,
    mode,
  );
  const shuffledVideos = shuffleItems(eligibleVideos);
  const queuePayload = shuffledVideos.map((videoRecord, index) => ({
    participant_id: participantId,
    session_number: sessionNumber,
    video_id: videoRecord.video_id,
    video_order: index + 1
  }));

  console.log("assessment_queue insert payload", queuePayload);

  const result = await supabase.from(QUEUE_TABLE_NAME).insert(queuePayload);

  console.log("assessment_queue insert result", result);

  if (result.error) {
    throw new Error(result.error.message);
  }

  return fetchAssessmentQueueRows(supabase, participantId, sessionNumber);
}

async function loadVideoSourcesForQueue(
  supabase: SupabaseClient,
  queueRows: AssessmentQueueRow[],
  sessionNumber: number,
  mode: StudyMode
) {
  const sortedQueueRows = validateQueueRows(queueRows);

  if (mode === "formal") {
    await fetchValidatedEligibleVideoRowsForSession(supabase, sessionNumber, mode);
  }

  if (mode === "formal" && sortedQueueRows.length !== FORMAL_VIDEOS_PER_SESSION) {
    throw new Error(
      formatFormalReadinessError(sessionNumber, sortedQueueRows.length)
    );
  }

  const videoIds = sortedQueueRows.map((row) => row.video_id);
  const { data: videoRows, error: videoError } = await fetchVideoRows(
    supabase,
    { videoIds }
  );

  if (videoError) {
    throw new Error(videoError.message);
  }

  const videoRecords = (videoRows ?? []) as VideoRow[];
  validateVideoRowsForStudyMode(
    videoRecords,
    mode,
    sessionNumber,
    "persisted queue"
  );
  console.log("fetched videos", videoRecords);
  const videoById = new Map(videoRecords.map((record) => [record.video_id, record]));

  return Promise.all(
    sortedQueueRows.map(async (queueRecord) => {
      const videoRecord = videoById.get(queueRecord.video_id);

      if (!videoRecord) {
        throw new Error(
          `assessment_queue references missing video_id ${queueRecord.video_id}.`
        );
      }

      if (!videoRecord.bucket || !videoRecord.file_path) {
        throw new Error(
          `videos record ${videoRecord.video_id} is missing bucket or file_path.`
        );
      }

      if (typeof videoRecord.has_lesion !== "boolean") {
        throw new Error(
          `videos record ${videoRecord.video_id} is missing boolean has_lesion.`
        );
      }

      const { data, error } = await supabase.storage
        .from(videoRecord.bucket)
        .createSignedUrl(videoRecord.file_path, 60 * 60);

      if (error) {
        throw new Error(error.message);
      }

      console.log("generated video URL", {
        video_id: videoRecord.video_id,
        bucket: videoRecord.bucket,
        file_path: videoRecord.file_path,
        signedUrl: data.signedUrl
      });

      return {
        videoId: videoRecord.video_id,
        videoOrder: parseQueueOrder(queueRecord.video_order),
        bucket: videoRecord.bucket,
        filePath: videoRecord.file_path,
        signedUrl: data.signedUrl,
        hasLesion: videoRecord.has_lesion,
        lesionOnsetSec: parseOptionalSeconds(videoRecord.lesion_onset_sec)
      };
    })
  );
}

export async function loadVideoQueue(
  participantId: string,
  sessionNumber: number
): Promise<VideoSource[]> {
  const supabase = getSupabaseClient();
  const mode = getStudyMode();

  if (!supabase) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }

  const existingQueueRows = await fetchAssessmentQueueRows(
    supabase,
    participantId,
    sessionNumber
  );

  console.log("assessment_queue fetched rows", existingQueueRows);

  const queueRows =
    existingQueueRows.length > 0
      ? existingQueueRows
      : await createAssessmentQueueRows(
          supabase,
          participantId,
          sessionNumber,
          mode
        );

  if (existingQueueRows.length > 0) {
    console.log("assessment_queue reused persisted order", queueRows);
  } else {
    console.log("assessment_queue created persisted order", queueRows);
  }

  return loadVideoSourcesForQueue(supabase, queueRows, sessionNumber, mode);
}

export async function loadAssessmentSession(
  participantId: string,
  sessionNumber: number
): Promise<AssessmentSession> {
  const supabase = getSupabaseClient();

  if (!supabase) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }

  const videoQueue = await loadVideoQueue(participantId, sessionNumber);
  const completionVideoOrder = videoQueue.length + 1;
  const nextVideoOrder = await fetchNextVideoOrder(
    supabase,
    participantId,
    sessionNumber,
    videoQueue.length
  );
  const startIndex =
    nextVideoOrder === completionVideoOrder
      ? -1
      : videoQueue.findIndex((video) => video.videoOrder === nextVideoOrder);

  if (nextVideoOrder !== completionVideoOrder && startIndex === -1) {
    throw new Error(
      `${NEXT_VIDEO_ORDER_FUNCTION} returned video_order ${nextVideoOrder}, but it is not present in assessment_queue.`
    );
  }

  const completedVideoOrders = videoQueue
    .filter((video) => video.videoOrder < nextVideoOrder)
    .map((video) => video.videoOrder);

  console.log("assessment resume status", {
    nextVideoOrder,
    queueLength: videoQueue.length,
    completionVideoOrder,
    completedVideoOrders,
    startIndex,
    isComplete: startIndex === -1
  });

  return {
    videoQueue,
    startIndex: startIndex === -1 ? videoQueue.length : startIndex,
    completedVideoOrders,
    isComplete: startIndex === -1
  };
}
