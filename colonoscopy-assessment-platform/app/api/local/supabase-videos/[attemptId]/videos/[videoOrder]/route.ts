import "server-only";

import {
  createLocalVideoRouteHandlers
} from "../../../../attempts/[attemptId]/videos/[videoOrder]/route.ts";
import { authorizeLocalSupabaseVideo } from "../../../../../../../lib/local/supabaseLocalVideoAuthorization.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handlers = createLocalVideoRouteHandlers({
  authorizationRepository: {
    authorizeCurrentVideo: authorizeLocalSupabaseVideo
  }
});

export const GET = handlers.GET;
export const HEAD = handlers.HEAD;
