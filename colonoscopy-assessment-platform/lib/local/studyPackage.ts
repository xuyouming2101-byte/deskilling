import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { open, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import canonicalize from "canonicalize";
import { resolveAuthorizedMp4 } from "../video/localPath.ts";
import { CURRENT_LOCAL_SCHEMA_VERSION } from "./sqlite/schema.ts";

export type LocalStudyMode = "dev" | "formal";
export type LocalSessionPool = 1 | 2 | 3 | null;

export type LocalStudyVideoDraft = {
  videoId: string;
  filePath: string;
  hasLesion: boolean;
  lesionOnsetSec: number | null;
  isTest: boolean;
  sessionPool: LocalSessionPool;
};

export type LocalStudyPackageDraftV1 = {
  packageVersion: 1;
  minimumSchemaVersion: 1;
  studyMode: LocalStudyMode;
  generatedAt: string;
  allowedParticipantIds: readonly string[];
  videos: readonly LocalStudyVideoDraft[];
};

export type LocalStudyPackageVideoV1 = LocalStudyVideoDraft & {
  fileSizeBytes: number;
  fileSha256: string;
};

export type LocalStudyPackageV1 = {
  packageVersion: 1;
  minimumSchemaVersion: 1;
  studyMode: LocalStudyMode;
  generatedAt: string;
  allowedParticipantIds: readonly string[];
  videos: readonly LocalStudyPackageVideoV1[];
  checksumSha256: string;
};

const PACKAGE_KEYS = [
  "packageVersion",
  "minimumSchemaVersion",
  "studyMode",
  "generatedAt",
  "allowedParticipantIds",
  "videos"
] as const;
const SEALED_PACKAGE_KEYS = [...PACKAGE_KEYS, "checksumSha256"] as const;
const VIDEO_KEYS = [
  "videoId",
  "filePath",
  "hasLesion",
  "lesionOnsetSec",
  "isTest",
  "sessionPool"
] as const;
const SEALED_VIDEO_KEYS = [
  ...VIDEO_KEYS,
  "fileSizeBytes",
  "fileSha256"
] as const;
const UTC_MILLISECOND_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CODED_PARTICIPANT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SECRET_LIKE_PATTERN = /password|secret|access[_-]?code|token|credential/i;

function assertRecord(value: unknown, label: string): asserts value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`);
  }
}

function assertExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();

  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`${label} contains missing or unsupported fields.`);
  }
}

function assertNormalizedString(value: unknown, label: string): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.trim() !== value ||
    value.includes("\0")
  ) {
    throw new Error(`${label} must be a normalized non-empty string.`);
  }

  return value;
}

function normalizeParticipantIds(
  participantIds: unknown,
  requireNonEmpty: boolean
): string[] {
  if (!Array.isArray(participantIds)) {
    throw new Error("allowedParticipantIds must be an array.");
  }

  const normalized = participantIds.map((value) => {
    const participantId = assertNormalizedString(value, "Participant ID");

    if (
      !CODED_PARTICIPANT_ID_PATTERN.test(participantId) ||
      UUID_PATTERN.test(participantId) ||
      SECRET_LIKE_PATTERN.test(participantId)
    ) {
      throw new Error("FORMAL roster must contain coded participant IDs only.");
    }

    return participantId;
  });

  if (requireNonEmpty && normalized.length === 0) {
    throw new Error("FORMAL participant roster must not be empty.");
  }

  if (new Set(normalized).size !== normalized.length) {
    throw new Error("FORMAL participant roster contains duplicate IDs.");
  }

  return normalized.sort((left, right) => left.localeCompare(right));
}

function validateGeneratedAt(value: unknown): string {
  if (
    typeof value !== "string" ||
    !UTC_MILLISECOND_PATTERN.test(value) ||
    Number.isNaN(Date.parse(value))
  ) {
    throw new Error("generatedAt must be a UTC timestamp with millisecond precision.");
  }

  return value;
}

function validateVideoDraft(value: unknown): LocalStudyVideoDraft {
  assertRecord(value, "Video metadata");
  assertExactKeys(value, VIDEO_KEYS, "Video metadata");

  const videoId = assertNormalizedString(value.videoId, "videoId");
  const filePath = assertNormalizedString(value.filePath, "filePath");

  if (typeof value.hasLesion !== "boolean" || typeof value.isTest !== "boolean") {
    throw new Error(`Video ${videoId} has invalid boolean metadata.`);
  }

  if (
    value.sessionPool !== null &&
    value.sessionPool !== 1 &&
    value.sessionPool !== 2 &&
    value.sessionPool !== 3
  ) {
    throw new Error(`Video ${videoId} has an invalid session pool.`);
  }

  if (value.hasLesion) {
    if (
      typeof value.lesionOnsetSec !== "number" ||
      !Number.isFinite(value.lesionOnsetSec) ||
      value.lesionOnsetSec < 0
    ) {
      throw new Error(`Video ${videoId} requires a valid lesion onset.`);
    }
  } else if (value.lesionOnsetSec !== null) {
    throw new Error(`Video ${videoId} must not define a lesion onset.`);
  }

  return {
    videoId,
    filePath,
    hasLesion: value.hasLesion,
    lesionOnsetSec: value.lesionOnsetSec as number | null,
    isTest: value.isTest,
    sessionPool: value.sessionPool
  };
}

function sortVideos<T extends LocalStudyVideoDraft>(videos: readonly T[]): T[] {
  return [...videos].sort((left, right) => {
    const poolDifference = (left.sessionPool ?? 0) - (right.sessionPool ?? 0);
    return poolDifference || left.videoId.localeCompare(right.videoId);
  });
}

function validateVideoSet(
  videosInput: unknown,
  studyMode: LocalStudyMode
): LocalStudyVideoDraft[] {
  if (!Array.isArray(videosInput) || videosInput.length === 0) {
    throw new Error("Study package must contain videos.");
  }

  const videos = videosInput.map(validateVideoDraft);

  if (new Set(videos.map((video) => video.videoId)).size !== videos.length) {
    throw new Error("Study package requires unique video IDs across all pools.");
  }

  if (new Set(videos.map((video) => video.filePath)).size !== videos.length) {
    throw new Error("Study package requires unique file paths across all pools.");
  }

  if (studyMode === "dev") {
    if (videos.some((video) => !video.isTest)) {
      throw new Error("DEV packages may contain test videos only.");
    }
  } else {
    if (videos.some((video) => video.isTest)) {
      throw new Error("FORMAL packages must not contain test videos.");
    }

    for (const sessionPool of [1, 2, 3] as const) {
      const count = videos.filter(
        (video) => video.sessionPool === sessionPool
      ).length;

      if (count !== 40) {
        throw new Error(
          `Session ${sessionPool} is not ready: ${count}/40 formal videos configured.`
        );
      }
    }

    if (videos.length !== 120 || videos.some((video) => video.sessionPool === null)) {
      throw new Error("FORMAL packages require exactly 120 pooled videos.");
    }
  }

  return sortVideos(videos);
}

function validateDraft(value: unknown): LocalStudyPackageDraftV1 {
  assertRecord(value, "Study package draft");
  assertExactKeys(value, PACKAGE_KEYS, "Study package draft");

  if (value.packageVersion !== 1 || value.minimumSchemaVersion !== 1) {
    throw new Error("Unsupported LOCAL study package or schema version.");
  }

  if (value.studyMode !== "dev" && value.studyMode !== "formal") {
    throw new Error("Study package mode must be dev or formal.");
  }

  return {
    packageVersion: 1,
    minimumSchemaVersion: 1,
    studyMode: value.studyMode,
    generatedAt: validateGeneratedAt(value.generatedAt),
    allowedParticipantIds: normalizeParticipantIds(
      value.allowedParticipantIds,
      value.studyMode === "formal"
    ),
    videos: validateVideoSet(value.videos, value.studyMode)
  };
}

async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");

  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }

  return hash.digest("hex");
}

function canonicalManifest(value: Omit<LocalStudyPackageV1, "checksumSha256">): string {
  const canonical = canonicalize(value);

  if (typeof canonical !== "string") {
    throw new Error("Unable to canonicalize LOCAL study package.");
  }

  return canonical;
}

function checksumManifest(
  value: Omit<LocalStudyPackageV1, "checksumSha256">
): string {
  return createHash("sha256").update(canonicalManifest(value)).digest("hex");
}

export function parseFormalParticipantRosterCsv(csv: string): string[] {
  if (typeof csv !== "string") {
    throw new Error("FORMAL roster must be UTF-8 CSV text.");
  }

  const lines = csv.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n");

  while (lines.at(-1) === "") {
    lines.pop();
  }

  const header = lines.shift();

  if (header !== "participant_id") {
    if (header && /password|secret|email|auth|access|token|hash/i.test(header)) {
      throw new Error("FORMAL roster must never contain credential columns.");
    }

    throw new Error("FORMAL roster header must be exactly participant_id.");
  }

  if (lines.some((line) => line.includes(",") || line.includes('"'))) {
    throw new Error("FORMAL roster rows must contain one coded participant ID.");
  }

  return normalizeParticipantIds(lines, true);
}

export async function buildLocalStudyPackage(
  draftInput: unknown,
  videoRoot: string
): Promise<LocalStudyPackageV1> {
  const draft = validateDraft(draftInput);
  const videos = await Promise.all(
    draft.videos.map(async (video) => {
      let realPath: string;

      try {
        realPath = await resolveAuthorizedMp4(videoRoot, video.filePath);
      } catch {
        throw new Error(`LOCAL video ${video.videoId} is missing or invalid.`);
      }

      const fileStats = await stat(realPath);

      if (fileStats.size <= 0) {
        throw new Error(`LOCAL video ${video.videoId} is empty.`);
      }

      return {
        ...video,
        fileSizeBytes: fileStats.size,
        fileSha256: await sha256File(realPath)
      };
    })
  );
  const manifest: Omit<LocalStudyPackageV1, "checksumSha256"> = {
    ...draft,
    videos
  };

  return {
    ...manifest,
    checksumSha256: checksumManifest(manifest)
  };
}

function parseSealedVideo(value: unknown): LocalStudyPackageVideoV1 {
  assertRecord(value, "Sealed video metadata");
  assertExactKeys(value, SEALED_VIDEO_KEYS, "Sealed video metadata");
  const draft = validateVideoDraft(
    Object.fromEntries(VIDEO_KEYS.map((key) => [key, value[key]]))
  );

  if (
    typeof value.fileSizeBytes !== "number" ||
    !Number.isSafeInteger(value.fileSizeBytes) ||
    value.fileSizeBytes <= 0 ||
    typeof value.fileSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(value.fileSha256)
  ) {
    throw new Error(`Video ${draft.videoId} has invalid file evidence.`);
  }

  return {
    ...draft,
    fileSizeBytes: value.fileSizeBytes,
    fileSha256: value.fileSha256
  };
}

export function assertLocalStudyPackageSeal(
  packageInput: unknown
): LocalStudyPackageV1 {
  assertRecord(packageInput, "Sealed study package");
  assertExactKeys(packageInput, SEALED_PACKAGE_KEYS, "Sealed study package");

  if (
    typeof packageInput.checksumSha256 !== "string" ||
    !/^[0-9a-f]{64}$/.test(packageInput.checksumSha256)
  ) {
    throw new Error("Study package checksum is invalid.");
  }

  const sealedVideos = (packageInput.videos as unknown[]).map(parseSealedVideo);
  const draft = validateDraft({
    packageVersion: packageInput.packageVersion,
    minimumSchemaVersion: packageInput.minimumSchemaVersion,
    studyMode: packageInput.studyMode,
    generatedAt: packageInput.generatedAt,
    allowedParticipantIds: packageInput.allowedParticipantIds,
    videos: sealedVideos.map((video) =>
      Object.fromEntries(VIDEO_KEYS.map((key) => [key, video[key]]))
    )
  });
  const sortedVideos = sortVideos(sealedVideos);

  if (JSON.stringify(sealedVideos) !== JSON.stringify(sortedVideos)) {
    throw new Error("Study package videos are not in canonical order.");
  }

  const manifest: Omit<LocalStudyPackageV1, "checksumSha256"> = {
    ...draft,
    videos: sealedVideos
  };
  const expectedChecksum = checksumManifest(manifest);

  if (expectedChecksum !== packageInput.checksumSha256) {
    throw new Error("Study package checksum does not match its manifest.");
  }

  if (manifest.minimumSchemaVersion > CURRENT_LOCAL_SCHEMA_VERSION) {
    throw new Error("Study package requires a newer LOCAL SQLite schema.");
  }

  return {
    ...manifest,
    checksumSha256: packageInput.checksumSha256
  };
}

export async function validateLocalStudyPackage(
  packageInput: unknown,
  videoRoot: string
): Promise<LocalStudyPackageV1> {
  const studyPackage = assertLocalStudyPackageSeal(packageInput);

  for (const video of studyPackage.videos) {
    let realPath: string;

    try {
      realPath = await resolveAuthorizedMp4(videoRoot, video.filePath);
    } catch {
      throw new Error(`LOCAL video ${video.videoId} is missing or invalid.`);
    }

    const fileStats = await stat(realPath);
    const fileSha256 = await sha256File(realPath);

    if (
      fileStats.size !== video.fileSizeBytes ||
      fileSha256 !== video.fileSha256
    ) {
      throw new Error(`LOCAL video ${video.videoId} size or SHA-256 mismatch.`);
    }
  }

  return studyPackage;
}

export async function writeLocalStudyPackageAtomically(
  outputPath: string,
  studyPackage: LocalStudyPackageV1
): Promise<void> {
  if (!path.isAbsolute(outputPath)) {
    throw new Error("Study package output path must be absolute.");
  }

  const relativeToRepository = path.relative(process.cwd(), outputPath);

  if (
    relativeToRepository !== "" &&
    !relativeToRepository.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relativeToRepository)
  ) {
    throw new Error("Study package output must remain outside the Git workspace.");
  }

  const temporaryPath = `${outputPath}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, "wx", 0o600);

  try {
    await handle.writeFile(`${JSON.stringify(studyPackage, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    await rename(temporaryPath, outputPath);
  } catch (error) {
    await handle.close().catch(() => undefined);
    await rm(temporaryPath, { force: true });
    throw error;
  }
}
