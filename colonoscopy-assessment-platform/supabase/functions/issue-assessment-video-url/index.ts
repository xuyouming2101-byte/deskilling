import { createClient } from "npm:@supabase/supabase-js@2.55.0";

const SIGNED_URL_EXPIRY_SECONDS = 6 * 60 * 60;
const AUTHORIZATION_FUNCTION = "authorize_current_assessment_video";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json"
};

type RequestBody = {
  participant_id?: unknown;
  session_number?: unknown;
  video_order?: unknown;
};

function jsonResponse(body: object, status: number) {
  return new Response(JSON.stringify(body), { status, headers: corsHeaders });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  try {
    const body = (await request.json()) as RequestBody;
    const participantId =
      typeof body.participant_id === "string"
        ? body.participant_id.trim()
        : "";
    const sessionNumber = Number(body.session_number);
    const videoOrder = Number(body.video_order);

    if (
      participantId.length === 0 ||
      !Number.isInteger(sessionNumber) ||
      sessionNumber < 1 ||
      sessionNumber > 3 ||
      !Number.isInteger(videoOrder) ||
      videoOrder < 1
    ) {
      return jsonResponse({ error: "Video access denied." }, 403);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !serviceRoleKey) {
      return jsonResponse({ error: "Video service is not configured." }, 500);
    }

    const serviceClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: {
        autoRefreshToken: false,
        persistSession: false
      }
    });
    const authorization = await serviceClient.rpc(AUTHORIZATION_FUNCTION, {
      p_participant_id: participantId,
      p_session_number: sessionNumber,
      p_video_order: videoOrder
    });
    const rows = Array.isArray(authorization.data) ? authorization.data : [];
    const authorizedVideo = rows[0] as
      | { bucket?: unknown; file_path?: unknown }
      | undefined;

    if (
      authorization.error ||
      rows.length !== 1 ||
      typeof authorizedVideo?.bucket !== "string" ||
      authorizedVideo.bucket.length === 0 ||
      typeof authorizedVideo.file_path !== "string" ||
      authorizedVideo.file_path.length === 0
    ) {
      return jsonResponse({ error: "Video access denied." }, 403);
    }

    const signed = await serviceClient.storage
      .from(authorizedVideo.bucket)
      .createSignedUrl(authorizedVideo.file_path, SIGNED_URL_EXPIRY_SECONDS);

    if (signed.error || !signed.data?.signedUrl) {
      return jsonResponse({ error: "Unable to prepare video playback." }, 500);
    }

    return jsonResponse(
      {
        signed_url: signed.data.signedUrl,
        video_order: videoOrder,
        expires_in_seconds: SIGNED_URL_EXPIRY_SECONDS
      },
      200
    );
  } catch {
    return jsonResponse({ error: "Video access denied." }, 403);
  }
});
