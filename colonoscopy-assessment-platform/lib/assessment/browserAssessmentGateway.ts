import type { VideoSubmission } from "../assessmentTypes.ts";

export type BrowserVideoQueueItem = {
  videoId: string;
  videoOrder: number;
};

export type BrowserAssessmentSession = {
  attemptId: string;
  videoQueue: BrowserVideoQueueItem[];
  startIndex: number;
  isComplete: boolean;
};

export type BrowserVideoSource = BrowserVideoQueueItem & {
  playbackUrl: string;
};

export type BrowserStartInput = {
  participantId: string;
  sessionNumber: 1 | 2 | 3;
  attemptId?: string;
};

export interface BrowserAssessmentGateway {
  isConfigured: boolean;
  startOrResume(input: BrowserStartInput): Promise<BrowserAssessmentSession>;
  loadCurrentVideo(input: {
    attemptId: string;
    participantId: string;
    sessionNumber: 1 | 2 | 3;
    video: BrowserVideoQueueItem;
  }): Promise<BrowserVideoSource>;
  submitResponse(
    attemptId: string,
    submission: VideoSubmission
  ): Promise<{ nextVideoOrder: number; isComplete: boolean }>;
}

async function postJson(
  fetcher: typeof fetch,
  url: string,
  body: Record<string, unknown>
): Promise<unknown> {
  const response = await fetcher(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const payload = await response.json().catch(() => null) as
    | Record<string, unknown>
    | null;

  if (!response.ok) {
    const message = typeof payload?.message === "string"
      ? payload.message
      : `LOCAL assessment request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }

  return payload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parsePositiveInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`LOCAL assessment returned invalid ${label}.`);
  }

  return value as number;
}

function parseSession(payload: unknown): BrowserAssessmentSession {
  if (!isRecord(payload)) {
    throw new Error("LOCAL assessment returned an invalid start response.");
  }

  if (payload.kind === "attempt_choice_required") {
    throw new Error(
      "Multiple in-progress attempts require operator resolution before continuing."
    );
  }

  if (payload.kind !== "session" || !isRecord(payload.session)) {
    throw new Error("LOCAL assessment returned an invalid session.");
  }

  const session = payload.session;

  if (
    typeof session.attemptId !== "string" ||
    session.attemptId.length === 0 ||
    !Array.isArray(session.queue) ||
    typeof session.isComplete !== "boolean"
  ) {
    throw new Error("LOCAL assessment returned incomplete session data.");
  }

  const videoQueue = session.queue.map((item, index) => {
    if (!isRecord(item) || typeof item.videoId !== "string") {
      throw new Error("LOCAL assessment returned an invalid queue item.");
    }

    const videoOrder = parsePositiveInteger(item.videoOrder, "video order");

    if (videoOrder !== index + 1) {
      throw new Error("LOCAL assessment returned a non-contiguous queue.");
    }

    return { videoId: item.videoId, videoOrder };
  });
  const nextVideoOrder = parsePositiveInteger(
    session.nextVideoOrder,
    "next video order"
  );

  if (
    videoQueue.length === 0 ||
    nextVideoOrder > videoQueue.length + 1 ||
    session.isComplete !== (nextVideoOrder === videoQueue.length + 1)
  ) {
    throw new Error("LOCAL assessment returned inconsistent progress.");
  }

  return {
    attemptId: session.attemptId,
    videoQueue,
    startIndex: session.isComplete ? videoQueue.length : nextVideoOrder - 1,
    isComplete: session.isComplete
  };
}

export function createLocalBrowserAssessmentGateway(
  fetcher: typeof fetch = fetch
): BrowserAssessmentGateway {
  return {
    isConfigured: true,

    async startOrResume(input) {
      const body: Record<string, unknown> = {
        participant_id: input.participantId,
        session_number: input.sessionNumber
      };

      if (input.attemptId) {
        body.attempt_id = input.attemptId;
      }

      return parseSession(
        await postJson(fetcher, "/api/assessment/start", body)
      );
    },

    async loadCurrentVideo(input) {
      const payload = await postJson(fetcher, "/api/assessment/video", {
        attempt_id: input.attemptId,
        video_order: input.video.videoOrder
      });

      if (
        !isRecord(payload) ||
        payload.attemptId !== input.attemptId ||
        payload.videoId !== input.video.videoId ||
        payload.videoOrder !== input.video.videoOrder ||
        typeof payload.url !== "string" ||
        !payload.url.startsWith(
          `/api/local/attempts/${encodeURIComponent(input.attemptId)}/videos/`
        )
      ) {
        throw new Error("LOCAL video authorization returned invalid data.");
      }

      return {
        ...input.video,
        playbackUrl: payload.url
      };
    },

    async submitResponse(attemptId, submission) {
      const payload = await postJson(fetcher, "/api/assessment/response", {
        attempt_id: attemptId,
        video_order: submission.video_order,
        answer: submission.final_answer,
        response_time_ms: submission.response_time_ms,
        no_response_latency_ms: submission.no_response_latency_ms,
        video_completed: submission.video_completed,
        clicks: submission.clicks.map((click) => ({ ...click }))
      });

      if (!isRecord(payload) || payload.attemptId !== attemptId) {
        throw new Error("LOCAL response commit returned invalid data.");
      }

      return {
        nextVideoOrder: parsePositiveInteger(
          payload.nextVideoOrder,
          "next video order"
        ),
        isComplete: payload.isComplete === true
      };
    }
  };
}

function createOnlineBrowserAssessmentGateway(): BrowserAssessmentGateway {
  return {
    isConfigured: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ),

    async startOrResume(input) {
      const { loadAssessmentSession } = await import("../supabaseClient.ts");
      const session = await loadAssessmentSession(
        input.participantId,
        input.sessionNumber
      );

      return {
        attemptId: "online",
        videoQueue: session.videoQueue,
        startIndex: session.startIndex,
        isComplete: session.isComplete
      };
    },

    async loadCurrentVideo(input) {
      const { loadCurrentVideoSource } = await import("../supabaseClient.ts");
      const source = await loadCurrentVideoSource(
        input.participantId,
        input.sessionNumber,
        input.video
      );

      return {
        ...input.video,
        playbackUrl: source.signedUrl
      };
    },

    async submitResponse(_attemptId, submission) {
      const { submitVideoResponse } = await import("../supabaseClient.ts");
      await submitVideoResponse(submission);

      return {
        nextVideoOrder: submission.video_order + 1,
        isComplete: false
      };
    }
  };
}

export function createBrowserAssessmentGateway(
  deploymentMode: "local" | "online",
  fetcher: typeof fetch = fetch
): BrowserAssessmentGateway {
  return deploymentMode === "local"
    ? createLocalBrowserAssessmentGateway(fetcher)
    : createOnlineBrowserAssessmentGateway();
}
