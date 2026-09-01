import "server-only";

import type { SessionNumber } from "../assessment/contracts.ts";
import { getSupabaseServerClient } from "../supabaseServerClient.ts";

type SupabaseLocalAttempt = {
  participantId: string;
  sessionNumber: SessionNumber;
};

function parseLocalSupabaseAttemptId(value: string): SupabaseLocalAttempt | null {
  const prefix = "supabase:";

  if (!value.startsWith(prefix)) {
    return null;
  }

  const encoded = value.slice(prefix.length);
  const separator = encoded.lastIndexOf(":");
  const participantId = separator > 0 ? encoded.slice(0, separator) : "";
  const sessionNumber = Number(encoded.slice(separator + 1));

  if (
    !participantId ||
    (sessionNumber !== 1 && sessionNumber !== 2 && sessionNumber !== 3)
  ) {
    return null;
  }

  return {
    participantId,
    sessionNumber
  };
}

export async function authorizeLocalSupabaseVideo(
  attemptId: string,
  videoOrder: number
): Promise<{ videoId: string; relativeFilePath: string }> {
  const attempt = parseLocalSupabaseAttemptId(attemptId);

  if (!attempt) {
    throw new Error("The LOCAL Supabase assessment identity is invalid.");
  }

  const supabase = getSupabaseServerClient();

  if (!supabase) {
    throw new Error(
      "Supabase server credentials are not configured for LOCAL video authorization."
    );
  }

  const { data, error } = await supabase.rpc(
    "authorize_current_assessment_video",
    {
      p_participant_id: attempt.participantId,
      p_session_number: attempt.sessionNumber,
      p_video_order: videoOrder
    }
  );

  if (error) {
    throw new Error("Unable to read the current video metadata from Supabase.");
  }

  if (!Array.isArray(data) || data.length !== 1) {
    throw new Error("The current video metadata is unavailable or ambiguous.");
  }

  const row = data[0] as {
    bucket?: unknown;
    file_path?: unknown;
  };

  if (
    typeof row.bucket !== "string" ||
    row.bucket.length === 0 ||
    typeof row.file_path !== "string" ||
    row.file_path.length === 0
  ) {
    throw new Error("The current video metadata is invalid.");
  }

  return {
    videoId: `video-order-${videoOrder}`,
    relativeFilePath: row.file_path
  };
}
