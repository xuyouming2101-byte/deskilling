import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export%20{}"
      };
    }

    return nextResolve(specifier, context);
  }
});

const {
  buildLocalStudyPackage,
  parseFormalParticipantRosterCsv,
  validateLocalStudyPackage,
  writeLocalStudyPackageAtomically
} = await import("./studyPackage.ts");

const GENERATED_AT = "2026-08-29T00:00:00.000Z";

async function withVideoRoot(
  run: (root: string) => Promise<void>
): Promise<void> {
  const root = await mkdtemp(path.join(tmpdir(), "deskilling-package-"));

  try {
    await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function createDevDraft() {
  return {
    packageVersion: 1 as const,
    minimumSchemaVersion: 1,
    studyMode: "dev" as const,
    generatedAt: GENERATED_AT,
    allowedParticipantIds: [] as string[],
    videos: [
      {
        videoId: "video_002",
        filePath: "video_002.mp4",
        hasLesion: false,
        lesionOnsetSec: null,
        isTest: true,
        sessionPool: null
      },
      {
        videoId: "video_001",
        filePath: "video_001.mp4",
        hasLesion: true,
        lesionOnsetSec: 1.25,
        isTest: true,
        sessionPool: null
      }
    ]
  };
}

function createFormalDraft() {
  const videos = [];

  for (const sessionPool of [1, 2, 3] as const) {
    for (let index = 1; index <= 40; index += 1) {
      const suffix = `${sessionPool}_${String(index).padStart(3, "0")}`;
      const hasLesion = index % 2 === 0;
      videos.push({
        videoId: `formal_${suffix}`,
        filePath: `formal_${suffix}.mp4`,
        hasLesion,
        lesionOnsetSec: hasLesion ? 1.5 + index / 100 : null,
        isTest: false,
        sessionPool
      });
    }
  }

  return {
    packageVersion: 1 as const,
    minimumSchemaVersion: 1,
    studyMode: "formal" as const,
    generatedAt: GENERATED_AT,
    allowedParticipantIds: ["P003", "P001", "P002"],
    videos
  };
}

async function writeDraftVideos(
  root: string,
  videos: readonly { filePath: string; videoId: string }[]
) {
  await Promise.all(
    videos.map((video) =>
      writeFile(path.join(root, video.filePath), Buffer.from(video.videoId))
    )
  );
}

test("builds a deterministic sealed DEV package from test videos", async () => {
  await withVideoRoot(async (root) => {
    const draft = createDevDraft();
    await writeDraftVideos(root, draft.videos);

    const first = await buildLocalStudyPackage(draft, root);
    const second = await buildLocalStudyPackage(
      { ...draft, videos: [...draft.videos].reverse() },
      root
    );

    assert.deepEqual(first, second);
    assert.equal(first.checksumSha256.length, 64);
    assert.deepEqual(
      first.videos.map((video) => video.videoId),
      ["video_001", "video_002"]
    );
    assert.ok(first.videos.every((video) => video.fileSizeBytes > 0));
    assert.ok(first.videos.every((video) => video.fileSha256.length === 64));
    await validateLocalStudyPackage(first, root);
  });
});

test("rejects checksum tampering and changed video bytes", async () => {
  await withVideoRoot(async (root) => {
    const draft = createDevDraft();
    await writeDraftVideos(root, draft.videos);
    const sealed = await buildLocalStudyPackage(draft, root);

    await assert.rejects(
      () =>
        validateLocalStudyPackage(
          { ...sealed, generatedAt: "2026-08-30T00:00:00.000Z" },
          root
        ),
      /checksum/i
    );

    await writeFile(path.join(root, "video_001.mp4"), "changed");
    await assert.rejects(
      () => validateLocalStudyPackage(sealed, root),
      /size or SHA-256/i
    );
  });
});

test("parses only a normalized coded-ID FORMAL roster", () => {
  assert.deepEqual(
    parseFormalParticipantRosterCsv("participant_id\nP003\nP001\nP002\n"),
    ["P001", "P002", "P003"]
  );

  for (const roster of [
    "participant_id\n",
    "participant_id\n P001\n",
    "participant_id\nP001\nP001\n",
    "participant_id,password\nP001,secret\n",
    "participant_id,email\nP001,p001@example.com\n",
    "participant_id\nuser@example.com\n",
    "participant_id\n550e8400-e29b-41d4-a716-446655440000\n",
    "participant_id\nP001,unexpected\n"
  ]) {
    assert.throws(() => parseFormalParticipantRosterCsv(roster));
  }
});

test("enforces exactly 40 unique non-test videos in each FORMAL pool", async () => {
  await withVideoRoot(async (root) => {
    const draft = createFormalDraft();

    await assert.rejects(
      () =>
        buildLocalStudyPackage(
          { ...draft, videos: draft.videos.slice(1) },
          root
        ),
      /Session 1.*39\/40 formal videos/
    );

    await assert.rejects(
      () =>
        buildLocalStudyPackage(
          {
            ...draft,
            videos: draft.videos.map((video, index) =>
              index === 0 ? { ...video, isTest: true } : video
            )
          },
          root
        ),
      /test videos/i
    );

    await assert.rejects(
      () =>
        buildLocalStudyPackage(
          {
            ...draft,
            videos: draft.videos.map((video, index) =>
              index === 40
                ? { ...video, videoId: draft.videos[0].videoId }
                : video
            )
          },
          root
        ),
      /unique video IDs/i
    );
  });
});

test("builds and validates a synthetic 120-video FORMAL package", async () => {
  await withVideoRoot(async (root) => {
    const draft = createFormalDraft();
    await writeDraftVideos(root, draft.videos);

    const sealed = await buildLocalStudyPackage(draft, root);

    assert.equal(sealed.videos.length, 120);
    assert.deepEqual(sealed.allowedParticipantIds, ["P001", "P002", "P003"]);
    for (const pool of [1, 2, 3]) {
      assert.equal(
        sealed.videos.filter((video) => video.sessionPool === pool).length,
        40
      );
    }
    await validateLocalStudyPackage(sealed, root);
  });
});

test("rejects incomplete lesion metadata", async () => {
  await withVideoRoot(async (root) => {
    const draft = createFormalDraft();

    await assert.rejects(
      () =>
        buildLocalStudyPackage(
          {
            ...draft,
            videos: draft.videos.map((video, index) =>
              index === 1 ? { ...video, lesionOnsetSec: null } : video
            )
          },
          root
        ),
      /lesion onset/i
    );
  });
});

test("writes the sealed package atomically outside Git", async () => {
  await withVideoRoot(async (root) => {
    const draft = createDevDraft();
    await writeDraftVideos(root, draft.videos);
    const sealed = await buildLocalStudyPackage(draft, root);
    const output = path.join(root, "package.study-package.json");

    await writeLocalStudyPackageAtomically(output, sealed);

    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), sealed);
  });
});
