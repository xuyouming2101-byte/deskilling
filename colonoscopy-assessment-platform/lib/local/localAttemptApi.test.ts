import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export%20{}"
      };
    }

    if (/supabase|storage/i.test(specifier)) {
      throw new Error(`LOCAL API imported forbidden adapter: ${specifier}`);
    }

    return nextResolve(specifier, context);
  }
});

const { buildLocalStudyPackage } = await import("./studyPackage.ts");
const localAttemptsRoute = await import(
  "../../app/api/local/attempts/route.ts"
);
const localResponseRoute = await import(
  "../../app/api/local/attempts/[attemptId]/responses/route.ts"
);
const localAbandonRoute = await import(
  "../../app/api/local/attempts/[attemptId]/abandon/route.ts"
);
const assessmentStartRoute = await import(
  "../../app/api/assessment/start/route.ts"
);
const assessmentResponseRoute = await import(
  "../../app/api/assessment/response/route.ts"
);
const assessmentVideoRoute = await import(
  "../../app/api/assessment/video/route.ts"
);
const streamingRoute = await import(
  "../../app/api/local/attempts/[attemptId]/videos/[videoOrder]/route.ts"
);

const GENERATED_AT = "2026-08-29T00:00:00.000Z";
const VIDEO_BYTES = Buffer.from([
  0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70,
  0x6d, 0x70, 0x34, 0x32, 0x6c, 0x6f, 0x63, 0x61,
  0x6c, 0x2d, 0x76, 0x69, 0x64, 0x65, 0x6f, 0x21
]);

function jsonRequest(url: string, body: unknown): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

function attemptContext(attemptId: string) {
  return { params: Promise.resolve({ attemptId }) };
}

function videoContext(attemptId: string, videoOrder: number) {
  return {
    params: Promise.resolve({
      attemptId,
      videoOrder: String(videoOrder)
    })
  };
}

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "deskilling-api-"));
  const packagePath = path.join(root, "study-package.json");
  const databasePath = path.join(root, "attempts.sqlite");
  const videos = [
    {
      videoId: "video_001",
      filePath: "video_001.mp4",
      hasLesion: true,
      lesionOnsetSec: 1.5,
      isTest: true,
      sessionPool: null
    },
    {
      videoId: "video_002",
      filePath: "video_002.mp4",
      hasLesion: false,
      lesionOnsetSec: null,
      isTest: true,
      sessionPool: null
    }
  ];

  await Promise.all(
    videos.map((video) => writeFile(path.join(root, video.filePath), VIDEO_BYTES))
  );
  const studyPackage = await buildLocalStudyPackage(
    {
      packageVersion: 1,
      minimumSchemaVersion: 1,
      studyMode: "dev",
      generatedAt: GENERATED_AT,
      allowedParticipantIds: [],
      videos
    },
    root
  );
  await writeFile(packagePath, JSON.stringify(studyPackage), "utf8");

  const previousEnvironment = {
    ASSESSMENT_DEPLOYMENT_MODE: process.env.ASSESSMENT_DEPLOYMENT_MODE,
    LOCAL_DATABASE_PATH: process.env.LOCAL_DATABASE_PATH,
    LOCAL_STUDY_PACKAGE_PATH: process.env.LOCAL_STUDY_PACKAGE_PATH,
    LOCAL_VIDEO_ROOT: process.env.LOCAL_VIDEO_ROOT
  };
  process.env.ASSESSMENT_DEPLOYMENT_MODE = "local";
  process.env.LOCAL_DATABASE_PATH = databasePath;
  process.env.LOCAL_STUDY_PACKAGE_PATH = packagePath;
  process.env.LOCAL_VIDEO_ROOT = root;

  return {
    root,
    databasePath,
    restore() {
      for (const [key, value] of Object.entries(previousEnvironment)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    },
    async cleanup() {
      this.restore();
      await rm(root, { recursive: true, force: true });
    }
  };
}

test("runs the LOCAL attempt API lifecycle entirely through SQLite", async () => {
  const fixture = await createFixture();

  try {
    const forbiddenStart = await localAttemptsRoute.POST(
      jsonRequest("http://localhost/api/local/attempts", {
        participant_id: "DEV001",
        session_number: 1,
        study_mode: "formal"
      })
    );
    assert.equal(forbiddenStart.status, 400);

    const start = await assessmentStartRoute.POST(
      jsonRequest("http://localhost/api/assessment/start", {
        participant_id: "DEV001",
        session_number: 1
      })
    );
    const started = await start.json();

    assert.equal(start.status, 200);
    assert.equal(started.kind, "session");
    assert.equal(started.session.queue.length, 2);
    assert.equal(started.session.nextVideoOrder, 1);
    assert.doesNotMatch(
      JSON.stringify(started),
      /studyMode|study_mode|hasLesion|has_lesion|lesionOnset|lesion_onset|filePath|file_path/
    );

    const attemptId = started.session.attemptId as string;
    const firstVideoId = started.session.queue[0].videoId as string;
    const forbiddenVideo = await assessmentVideoRoute.POST(
      jsonRequest("http://localhost/api/assessment/video", {
        attempt_id: attemptId,
        video_order: 1,
        has_lesion: true
      })
    );
    assert.equal(forbiddenVideo.status, 400);

    const sourceResponse = await assessmentVideoRoute.POST(
      jsonRequest("http://localhost/api/assessment/video", {
        attempt_id: attemptId,
        video_order: 1
      })
    );
    const source = await sourceResponse.json();

    assert.equal(sourceResponse.status, 200);
    assert.equal(source.videoId, firstVideoId);
    assert.equal(
      source.url,
      `/api/local/attempts/${encodeURIComponent(attemptId)}/videos/1`
    );
    assert.doesNotMatch(JSON.stringify(source), /\.mp4|deskilling-api-/);

    const future = await streamingRoute.GET(
      new Request("http://localhost/api/local/video"),
      videoContext(attemptId, 2)
    );
    assert.equal(future.status, 404);

    const partial = await streamingRoute.GET(
      new Request("http://localhost/api/local/video", {
        headers: { Range: "bytes=4-11" }
      }),
      videoContext(attemptId, 1)
    );
    assert.equal(partial.status, 206);
    assert.equal(partial.headers.get("content-range"), "bytes 4-11/24");
    assert.deepEqual(
      Buffer.from(await partial.arrayBuffer()),
      VIDEO_BYTES.subarray(4, 12)
    );

    const responsePayload = {
      attempt_id: attemptId,
      video_order: 1,
      answer: true,
      response_time_ms: 3000,
      no_response_latency_ms: null,
      video_completed: true,
      clicks: [
        {
          click_index: 1,
          video_time_at_click: 1.2,
          response_time_ms: 1200
        }
      ]
    };
    const submitted = await assessmentResponseRoute.POST(
      jsonRequest("http://localhost/api/assessment/response", responsePayload)
    );
    const submitResult = await submitted.json();
    assert.equal(submitted.status, 200);
    assert.equal(submitResult.nextVideoOrder, 2);

    const retry = await localResponseRoute.POST(
      jsonRequest("http://localhost/api/local/attempts/x/responses", responsePayload),
      attemptContext(attemptId)
    );
    assert.equal(retry.status, 200);
    assert.deepEqual(await retry.json(), submitResult);

    const mismatch = await localResponseRoute.POST(
      jsonRequest("http://localhost/api/local/attempts/x/responses", {
        ...responsePayload,
        attempt_id: "another-attempt"
      }),
      attemptContext(attemptId)
    );
    assert.equal(mismatch.status, 400);

    const previous = await streamingRoute.HEAD(
      new Request("http://localhost/api/local/video", { method: "HEAD" }),
      videoContext(attemptId, 1)
    );
    assert.equal(previous.status, 404);

    const resumed = await localAttemptsRoute.POST(
      jsonRequest("http://localhost/api/local/attempts", {
        participant_id: "DEV001",
        session_number: 1,
        attempt_id: attemptId
      })
    );
    assert.equal(resumed.status, 200);
    assert.equal((await resumed.json()).session.nextVideoOrder, 2);

    const secondStart = await localAttemptsRoute.POST(
      jsonRequest("http://localhost/api/local/attempts", {
        participant_id: "DEV001",
        session_number: 2
      })
    );
    const secondAttemptId = (await secondStart.json()).session.attemptId as string;
    const forbiddenAbandon = await localAbandonRoute.POST(
      jsonRequest("http://localhost/api/local/attempts/x/abandon", {
        study_mode: "dev"
      }),
      attemptContext(secondAttemptId)
    );
    assert.equal(forbiddenAbandon.status, 400);

    const abandoned = await localAbandonRoute.POST(
      jsonRequest("http://localhost/api/local/attempts/x/abandon", {}),
      attemptContext(secondAttemptId)
    );
    assert.equal(abandoned.status, 204);
    const abandonedVideo = await streamingRoute.GET(
      new Request("http://localhost/api/local/video"),
      videoContext(secondAttemptId, 1)
    );
    assert.equal(abandonedVideo.status, 404);

    const db = new Database(fixture.databasePath, { readonly: true });
    const counts = db
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM local_assessment_attempts) AS attempts,
          (SELECT COUNT(*) FROM local_responses) AS responses,
          (SELECT COUNT(*) FROM local_lesion_detection_events) AS events`
      )
      .get() as { attempts: number; responses: number; events: number };
    db.close();
    assert.deepEqual(counts, { attempts: 2, responses: 1, events: 1 });
  } finally {
    await fixture.cleanup();
  }
});

test("fails closed when the selected deployment is ONLINE", async () => {
  const fixture = await createFixture();

  try {
    process.env.ASSESSMENT_DEPLOYMENT_MODE = "online";

    const localStart = await localAttemptsRoute.POST(
      jsonRequest("http://localhost/api/local/attempts", {
        participant_id: "DEV001",
        session_number: 1
      })
    );
    assert.equal(localStart.status, 404);

    const sharedStart = await assessmentStartRoute.POST(
      jsonRequest("http://localhost/api/assessment/start", {
        participant_id: "DEV001",
        session_number: 1
      })
    );
    assert.equal(sharedStart.status, 501);

    const db = new Database(fixture.databasePath);
    const row = db
      .prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table'"
      )
      .get() as { count: number };
    db.close();
    assert.equal(row.count, 0);
  } finally {
    await fixture.cleanup();
  }
});
