import {
  isAllowedFormalVideoPath,
  verifyFormalVideoSignature
} from "../../../lib/formalVideoAuth.ts";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function forbidden() {
  return new Response("Forbidden", {
    status: 403,
    headers: {
      "Cache-Control": "private, no-store"
    }
  });
}

export async function GET(request: Request) {
  const secret = process.env.FORMAL_VIDEO_SIGNING_SECRET;

  if (!secret) {
    return new Response("Formal video service is not configured.", {
      status: 500,
      headers: {
        "Cache-Control": "private, no-store"
      }
    });
  }

  const url = new URL(request.url);
  const path = url.searchParams.get("path") ?? "";
  const signature = url.searchParams.get("sig") ?? "";
  const expiresRaw = url.searchParams.get("expires") ?? "";
  const expires = Number(expiresRaw);

  if (
    !isAllowedFormalVideoPath(path) ||
    !Number.isInteger(expires) ||
    expires <= 0
  ) {
    return forbidden();
  }

  const valid = verifyFormalVideoSignature({
    path,
    expires,
    signature,
    secret,
    nowSeconds: Math.floor(Date.now() / 1000)
  });

  if (!valid) {
    return forbidden();
  }

  return new Response(null, {
    status: 200,
    headers: {
      "X-Accel-Redirect": `/_formal_video/${path}`,
      "Cache-Control": "private, no-store",
      "Content-Type": "video/mp4"
    }
  });
}
