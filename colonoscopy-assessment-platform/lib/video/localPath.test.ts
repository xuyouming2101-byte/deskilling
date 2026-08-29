import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  LocalVideoPathError,
  resolveAuthorizedMp4
} from "./localPath.ts";

type Fixture = {
  base: string;
  root: string;
  video: string;
  outsideVideo: string;
};

async function createFixture(): Promise<Fixture> {
  const base = await mkdtemp(path.join(tmpdir(), "deskilling-path-test-"));
  const root = path.join(base, "videos");
  const nested = path.join(root, "nested");
  const video = path.join(nested, "video_001.mp4");
  const outsideVideo = path.join(base, "outside.mp4");

  await mkdir(nested, { recursive: true });
  await writeFile(video, Buffer.from("local-mp4-fixture"));
  await writeFile(outsideVideo, Buffer.from("outside"));

  return { base, root, video, outsideVideo };
}

async function withFixture(run: (fixture: Fixture) => Promise<void>) {
  const fixture = await createFixture();

  try {
    await run(fixture);
  } finally {
    await rm(fixture.base, { recursive: true, force: true });
  }
}

async function assertPathError(
  root: string,
  relativePath: string,
  expectedCode: string
) {
  await assert.rejects(
    () => resolveAuthorizedMp4(root, relativePath),
    (error) =>
      error instanceof LocalVideoPathError &&
      error.code === expectedCode &&
      !error.message.includes(root)
  );
}

test("resolves a regular readable MP4 under the real root", async () => {
  await withFixture(async ({ root, video }) => {
    assert.equal(
      await resolveAuthorizedMp4(root, "nested/video_001.mp4"),
      await realpath(video)
    );
  });
});

test("rejects empty, absolute, NUL, dot, traversal, and encoded traversal", async () => {
  await withFixture(async ({ root, video }) => {
    const rejected = [
      "",
      video,
      "nested/\0video.mp4",
      "./nested/video_001.mp4",
      "nested/../nested/video_001.mp4",
      "../outside.mp4",
      "%2e%2e%2foutside.mp4",
      "%252e%252e%252foutside.mp4",
      "C:\\outside.mp4"
    ];

    for (const relativePath of rejected) {
      await assertPathError(root, relativePath, "LOCAL_VIDEO_PATH_INVALID");
    }
  });
});

test("rejects non-MP4, missing files, and directories", async () => {
  await withFixture(async ({ root }) => {
    await writeFile(path.join(root, "video.txt"), "not a video");
    await mkdir(path.join(root, "directory.mp4"));

    await assertPathError(root, "video.txt", "LOCAL_VIDEO_PATH_INVALID");
    await assertPathError(root, "missing.mp4", "LOCAL_VIDEO_MISSING");
    await assertPathError(root, "directory.mp4", "LOCAL_VIDEO_PATH_INVALID");
  });
});

test("allows an internal symlink whose real target remains under the root", async () => {
  await withFixture(async ({ root, video }) => {
    const link = path.join(root, "video_link.mp4");
    await symlink(video, link);

    assert.equal(
      await resolveAuthorizedMp4(root, "video_link.mp4"),
      await realpath(video)
    );
  });
});

test("rejects a symlink whose real target escapes the root", async () => {
  await withFixture(async ({ root, outsideVideo }) => {
    await symlink(outsideVideo, path.join(root, "outside_link.mp4"));

    await assertPathError(
      root,
      "outside_link.mp4",
      "LOCAL_VIDEO_PATH_INVALID"
    );
  });
});
