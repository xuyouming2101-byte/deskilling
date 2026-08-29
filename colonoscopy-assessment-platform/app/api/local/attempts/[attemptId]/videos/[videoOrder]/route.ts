import "server-only";

import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import type { CurrentVideoAuthorizationRepository } from "../../../../../../../lib/assessment/contracts.ts";
import { withLocalAssessmentRepository } from "../../../../../../../lib/local/localRuntime.ts";
import type { DeploymentMode } from "../../../../../../../lib/runtime/deploymentMode.ts";
import { readDeploymentMode } from "../../../../../../../lib/runtime/deploymentMode.ts";
import {
  LocalVideoPathError,
  resolveAuthorizedMp4
} from "../../../../../../../lib/video/localPath.ts";
import {
  parseSingleRange,
  RangeNotSatisfiableError,
  type ByteRange
} from "../../../../../../../lib/video/rangeRequest.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = {
  params: Promise<{
    attemptId: string;
    videoOrder: string;
  }>;
};

type RouteHandler = (
  request: Request,
  context: RouteContext
) => Promise<Response>;

type LocalVideoRouteDependencies = {
  authorizationRepository: CurrentVideoAuthorizationRepository;
  readMode?: () => DeploymentMode;
  readVideoRoot?: () => string;
  resolveVideoPath?: typeof resolveAuthorizedMp4;
};

type LocalVideoRouteHandlers = {
  GET: RouteHandler;
  HEAD: RouteHandler;
};

function jsonError(code: string, message: string, status: number): Response {
  return Response.json({ code, message }, { status });
}

function parseVideoOrder(value: string): number | null {
  if (!/^[1-9]\d*$/.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function readConfiguredVideoRoot(): string {
  const root = process.env.LOCAL_VIDEO_ROOT;

  if (!root) {
    throw new LocalVideoPathError(
      "LOCAL_VIDEO_ROOT_INVALID",
      "LOCAL_VIDEO_ROOT is not configured."
    );
  }

  return root;
}

function createVideoHeaders(size: number, range: ByteRange | null): Headers {
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Length": String(range?.length ?? size),
    "Content-Type": "video/mp4"
  });

  if (range) {
    headers.set("Content-Range", `bytes ${range.start}-${range.end}/${size}`);
  }

  return headers;
}

function createRangeErrorResponse(size: number): Response {
  return new Response(null, {
    status: 416,
    headers: {
      "Accept-Ranges": "bytes",
      "Content-Range": `bytes */${size}`
    }
  });
}

function streamFile(
  request: Request,
  filePath: string,
  range: ByteRange | null,
  headers: Headers
): Response {
  const stream = createReadStream(filePath, range ?? undefined);
  request.signal.addEventListener("abort", () => stream.destroy(), {
    once: true
  });
  const body = Readable.toWeb(stream) as unknown as BodyInit;

  return new Response(body, {
    status: range ? 206 : 200,
    headers
  });
}

export function createLocalVideoRouteHandlers(
  dependencies: LocalVideoRouteDependencies
): LocalVideoRouteHandlers {
  const readMode = dependencies.readMode ?? readDeploymentMode;
  const readVideoRoot =
    dependencies.readVideoRoot ?? readConfiguredVideoRoot;
  const resolveVideoPath =
    dependencies.resolveVideoPath ?? resolveAuthorizedMp4;

  async function handle(
    request: Request,
    context: RouteContext,
    headOnly: boolean
  ): Promise<Response> {
    let mode: DeploymentMode;

    try {
      mode = readMode();
    } catch {
      return jsonError(
        "DEPLOYMENT_MODE_INVALID",
        "The server deployment mode is missing or invalid.",
        500
      );
    }

    if (mode !== "local") {
      return jsonError(
        "LOCAL_VIDEO_ROUTE_DISABLED",
        "The LOCAL video route is disabled in this deployment.",
        404
      );
    }

    const params = await context.params;
    const videoOrder = parseVideoOrder(params.videoOrder);

    if (!params.attemptId || videoOrder === null) {
      return jsonError(
        "LOCAL_VIDEO_REQUEST_INVALID",
        "The LOCAL video request is invalid.",
        400
      );
    }

    let authorized: { videoId: string; relativeFilePath: string };

    try {
      authorized =
        await dependencies.authorizationRepository.authorizeCurrentVideo(
          params.attemptId,
          videoOrder
        );
    } catch {
      return jsonError(
        "LOCAL_VIDEO_NOT_AUTHORIZED",
        "The requested video is not the current authorized video.",
        404
      );
    }

    let filePath: string;

    try {
      filePath = await resolveVideoPath(
        readVideoRoot(),
        authorized.relativeFilePath
      );
    } catch (error) {
      if (
        error instanceof LocalVideoPathError &&
        error.code === "LOCAL_VIDEO_MISSING"
      ) {
        return jsonError(
          "LOCAL_VIDEO_MISSING",
          `The LOCAL video file for ${authorized.videoId} is missing.`,
          404
        );
      }

      const code =
        error instanceof LocalVideoPathError
          ? error.code
          : "LOCAL_VIDEO_CONFIGURATION_ERROR";
      return jsonError(
        code,
        `The LOCAL video source for ${authorized.videoId} is invalid.`,
        500
      );
    }

    let size: number;

    try {
      size = (await stat(filePath)).size;
    } catch {
      return jsonError(
        "LOCAL_VIDEO_MISSING",
        `The LOCAL video file for ${authorized.videoId} is missing.`,
        404
      );
    }

    let range: ByteRange | null;

    try {
      range = parseSingleRange(request.headers.get("range"), size);
    } catch (error) {
      if (error instanceof RangeNotSatisfiableError) {
        return createRangeErrorResponse(size);
      }

      throw error;
    }

    const headers = createVideoHeaders(size, range);

    if (headOnly) {
      return new Response(null, {
        status: range ? 206 : 200,
        headers
      });
    }

    return streamFile(request, filePath, range, headers);
  }

  return {
    GET: (request, context) => handle(request, context, false),
    HEAD: (request, context) => handle(request, context, true)
  };
}

const sqliteAuthorizationRepository: CurrentVideoAuthorizationRepository = {
  async authorizeCurrentVideo(attemptId, videoOrder) {
    return withLocalAssessmentRepository(false, (repository) =>
      repository.authorizeCurrentVideo(attemptId, videoOrder)
    );
  }
};

const handlers = createLocalVideoRouteHandlers({
  authorizationRepository: sqliteAuthorizationRepository
});

export const GET = handlers.GET;
export const HEAD = handlers.HEAD;
