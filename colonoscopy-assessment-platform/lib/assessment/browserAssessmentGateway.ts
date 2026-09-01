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

type SupabaseAssessmentDataSource = Pick<
  typeof import("../supabaseClient.ts"),
  "loadAssessmentSession" | "submitVideoResponse"
>;

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
  _fetcher: typeof fetch = fetch,
  dataSource?: SupabaseAssessmentDataSource
): BrowserAssessmentGateway {
  return {
    isConfigured: Boolean(
      process.env.NEXT_PUBLIC_SUPABASE_URL &&
        process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    ),

    async startOrResume(input) {
      const { loadAssessmentSession } =
        dataSource ?? (await import("../supabaseClient.ts"));
      const session = await loadAssessmentSession(
        input.participantId,
        input.sessionNumber
      );

      return {
        attemptId: `supabase:${input.participantId}:${input.sessionNumber}`,
        videoQueue: session.videoQueue,
        startIndex: session.startIndex,
        isComplete: session.isComplete
      };
    },

    async loadCurrentVideo(input) {
      return {
        ...input.video,
        playbackUrl: `/api/local/supabase-videos/${encodeURIComponent(
          input.attemptId
        )}/videos/${input.video.videoOrder}`
      };
    },

    async submitResponse(attemptId, submission) {
      const { submitVideoResponse } =
        dataSource ?? (await import("../supabaseClient.ts"));
      await submitVideoResponse(submission);
      return {
        nextVideoOrder: submission.video_order + 1,
        isComplete: false
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
