import { constants } from "node:fs";
import { access, realpath, stat } from "node:fs/promises";
import path from "node:path";

export type LocalVideoPathErrorCode =
  | "LOCAL_VIDEO_ROOT_INVALID"
  | "LOCAL_VIDEO_PATH_INVALID"
  | "LOCAL_VIDEO_MISSING";

export class LocalVideoPathError extends Error {
  readonly code: LocalVideoPathErrorCode;

  constructor(code: LocalVideoPathErrorCode, message: string) {
    super(message);
    this.name = "LocalVideoPathError";
    this.code = code;
  }
}

function invalidPath(): never {
  throw new LocalVideoPathError(
    "LOCAL_VIDEO_PATH_INVALID",
    "The authorized LOCAL video path is invalid."
  );
}

function isContained(root: string, target: string): boolean {
  const relative = path.relative(root, target);

  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function decodeForTraversalCheck(value: string): string {
  let decoded = value;

  try {
    for (let index = 0; index < 2; index += 1) {
      const next = decodeURIComponent(decoded);

      if (next === decoded) {
        break;
      }

      decoded = next;
    }
  } catch {
    return invalidPath();
  }

  return decoded;
}

function hasUnsafeSegments(value: string): boolean {
  if (value.includes("\\")) {
    return true;
  }

  const segments = value.split("/");
  return segments.some((segment) => segment === "." || segment === "..");
}

export async function resolveAuthorizedMp4(
  root: string,
  relativePath: string
): Promise<string> {
  if (
    typeof root !== "string" ||
    root.length === 0 ||
    typeof relativePath !== "string" ||
    relativePath.length === 0 ||
    relativePath.includes("\0") ||
    path.isAbsolute(relativePath) ||
    hasUnsafeSegments(relativePath) ||
    hasUnsafeSegments(decodeForTraversalCheck(relativePath)) ||
    path.posix.normalize(relativePath) !== relativePath ||
    path.posix.extname(relativePath).toLowerCase() !== ".mp4"
  ) {
    return invalidPath();
  }

  let realRoot: string;

  try {
    realRoot = await realpath(root);
    const rootStats = await stat(realRoot);

    if (!rootStats.isDirectory()) {
      throw new Error("not a directory");
    }
  } catch {
    throw new LocalVideoPathError(
      "LOCAL_VIDEO_ROOT_INVALID",
      "LOCAL_VIDEO_ROOT is missing or invalid."
    );
  }

  const unresolvedTarget = path.resolve(realRoot, relativePath);

  if (!isContained(realRoot, unresolvedTarget)) {
    return invalidPath();
  }

  let realTarget: string;

  try {
    realTarget = await realpath(unresolvedTarget);
  } catch {
    throw new LocalVideoPathError(
      "LOCAL_VIDEO_MISSING",
      "The authorized LOCAL video file is missing."
    );
  }

  if (!isContained(realRoot, realTarget)) {
    return invalidPath();
  }

  try {
    const targetStats = await stat(realTarget);

    if (!targetStats.isFile()) {
      return invalidPath();
    }

    await access(realTarget, constants.R_OK);
  } catch (error) {
    if (error instanceof LocalVideoPathError) {
      throw error;
    }

    throw new LocalVideoPathError(
      "LOCAL_VIDEO_MISSING",
      "The authorized LOCAL video file is missing or unreadable."
    );
  }

  return realTarget;
}
