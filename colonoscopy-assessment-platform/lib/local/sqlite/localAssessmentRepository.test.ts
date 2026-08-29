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

    return nextResolve(specifier, context);
  }
});

const { buildLocalStudyPackage } = await import("../studyPackage.ts");
const { openLocalDatabase, migrateLocalDatabase } = await import("./database.ts");
const { LocalAssessmentRepository } = await import(
  "./localAssessmentRepository.ts"
);

const NOW = "2026-08-29T00:00:00.000Z";
const ATTEMPT_1 = "10000000-0000-4000-8000-000000000001";
const ATTEMPT_2 = "10000000-0000-4000-8000-000000000002";

async function withDirectory(
  run: (directory: string) => Promise<void>
): Promise<void> {
  const directory = await mkdtemp(path.join(tmpdir(), "deskilling-repo-"));

  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function createDevPackage(root: string, videoCount = 2) {
  const videos = Array.from({ length: videoCount }, (_, index) => {
    const number = index + 1;
    const hasLesion = number % 2 === 1;
    return {
      videoId: `video_${String(number).padStart(3, "0")}`,
      filePath: `video_${String(number).padStart(3, "0")}.mp4`,
      hasLesion,
      lesionOnsetSec: hasLesion ? 1.5 : null,
      isTest: true,
      sessionPool: null
    };
  });

  await Promise.all(
    videos.map((video) => writeFile(path.join(root, video.filePath), video.videoId))
  );

  return buildLocalStudyPackage(
    {
      packageVersion: 1,
      minimumSchemaVersion: 1,
      studyMode: "dev",
      generatedAt: NOW,
      allowedParticipantIds: [],
      videos
    },
    root
  );
}

async function createFormalPackage(root: string) {
  const videos = [];

  for (const sessionPool of [1, 2, 3] as const) {
    for (let index = 1; index <= 40; index += 1) {
      const suffix = `${sessionPool}_${String(index).padStart(3, "0")}`;
      const hasLesion = index % 2 === 0;
      videos.push({
        videoId: `formal_${suffix}`,
        filePath: `formal_${suffix}.mp4`,
        hasLesion,
        lesionOnsetSec: hasLesion ? 2 : null,
        isTest: false,
        sessionPool
      });
    }
  }

  await Promise.all(
    videos.map((video) => writeFile(path.join(root, video.filePath), video.videoId))
  );

  return buildLocalStudyPackage(
    {
      packageVersion: 1,
      minimumSchemaVersion: 1,
      studyMode: "formal",
      generatedAt: NOW,
      allowedParticipantIds: ["P001", "P002"],
      videos
    },
    root
  );
}

function openMigrated(databasePath: string) {
  const db = openLocalDatabase(databasePath);
  migrateLocalDatabase(db);
  return db;
}

function repositoryOptions(studyPackage: Awaited<ReturnType<typeof createDevPackage>>) {
  return {
    studyPackage,
    idFactory: () => ATTEMPT_1,
    now: () => NOW,
    shuffle: <T>(items: readonly T[]) => [...items]
  };
}

test("rejects an unknown FORMAL participant before creating rows", async () => {
  await withDirectory(async (directory) => {
    const studyPackage = await createFormalPackage(directory);
    const db = openMigrated(path.join(directory, "formal.sqlite"));
    const repository = new LocalAssessmentRepository(db, {
      ...repositoryOptions(studyPackage),
      studyPackage
    });

    await assert.rejects(
      () =>
        repository.createOrResumeAttempt({
          participantId: "P999",
          sessionNumber: 2
        }),
      /not in the sealed FORMAL participant roster/
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM local_assessment_attempts").get() as { count: number }).count,
      0
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM local_assessment_queue").get() as { count: number }).count,
      0
    );

    const result = await repository.createOrResumeAttempt({
      participantId: "P001",
      sessionNumber: 2
    });
    assert.equal(result.kind, "session");
    assert.equal(result.kind === "session" ? result.session.queue.length : 0, 40);
    assert.ok(
      result.kind === "session" &&
        result.session.queue.every((item) => item.videoId.startsWith("formal_2_"))
    );
    db.close();
  });
});

test("persists the complete randomized queue before returning Video 1", async () => {
  await withDirectory(async (directory) => {
    const studyPackage = await createDevPackage(directory, 3);
    const db = openMigrated(path.join(directory, "queue.sqlite"));
    const repository = new LocalAssessmentRepository(db, {
      studyPackage,
      idFactory: () => ATTEMPT_1,
      now: () => NOW,
      shuffle: <T>(items: readonly T[]) => [...items].reverse()
    });
    const result = await repository.createOrResumeAttempt({
      participantId: "DEV001",
      sessionNumber: 1
    });

    assert.equal(result.kind, "session");
    assert.deepEqual(
      result.kind === "session"
        ? result.session.queue.map((item) => item.videoId)
        : [],
      ["video_003", "video_002", "video_001"]
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM local_assessment_queue WHERE attempt_id = ?").get(ATTEMPT_1) as { count: number }).count,
      3
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM local_video_metadata_snapshot WHERE attempt_id = ?").get(ATTEMPT_1) as { count: number }).count,
      3
    );
    db.close();
  });
});

test("resumes the same attempt and queue after SQLite close and reopen", async () => {
  await withDirectory(async (directory) => {
    const databasePath = path.join(directory, "resume.sqlite");
    const studyPackage = await createDevPackage(directory);
    const firstDb = openMigrated(databasePath);
    const firstRepository = new LocalAssessmentRepository(
      firstDb,
      repositoryOptions(studyPackage)
    );
    const created = await firstRepository.createOrResumeAttempt({
      participantId: "DEV001",
      sessionNumber: 1
    });
    assert.equal(created.kind, "session");
    firstDb.close();

    const reopenedDb = openMigrated(databasePath);
    const reopenedRepository = new LocalAssessmentRepository(reopenedDb);
    const resumed = await reopenedRepository.createOrResumeAttempt({
      participantId: "DEV001",
      sessionNumber: 1,
      attemptId: ATTEMPT_1
    });

    assert.deepEqual(resumed, created);
    reopenedDb.close();
  });
});

test("requires explicit selection when multiple in-progress attempts exist", async () => {
  await withDirectory(async (directory) => {
    const studyPackage = await createDevPackage(directory);
    const db = openMigrated(path.join(directory, "choices.sqlite"));
    let nextId = ATTEMPT_1;
    const repository = new LocalAssessmentRepository(db, {
      ...repositoryOptions(studyPackage),
      idFactory: () => nextId
    });
    await repository.createOrResumeAttempt({
      participantId: "DEV001",
      sessionNumber: 1
    });
    await repository.markAttemptAbandoned(ATTEMPT_1);
    nextId = ATTEMPT_2;
    await repository.createOrResumeAttempt({
      participantId: "DEV001",
      sessionNumber: 1
    });
    db.prepare(
      "UPDATE local_assessment_attempts SET status = 'in_progress' WHERE attempt_id = ?"
    ).run(ATTEMPT_1);

    const result = await repository.createOrResumeAttempt({
      participantId: "DEV001",
      sessionNumber: 1
    });

    assert.equal(result.kind, "attempt_choice_required");
    assert.deepEqual(
      result.kind === "attempt_choice_required"
        ? result.attempts.map((attempt) => attempt.attemptId).sort()
        : [],
      [ATTEMPT_1, ATTEMPT_2]
    );
    db.close();
  });
});

test("commits positive events and response atomically with derived timing", async () => {
  await withDirectory(async (directory) => {
    const studyPackage = await createDevPackage(directory);
    const db = openMigrated(path.join(directory, "responses.sqlite"));
    const repository = new LocalAssessmentRepository(
      db,
      repositoryOptions(studyPackage)
    );
    await repository.createOrResumeAttempt({
      participantId: "DEV001",
      sessionNumber: 1
    });
    const submission = {
      attemptId: ATTEMPT_1,
      videoOrder: 1,
      answer: true,
      responseTimeMs: 5000,
      noResponseLatencyMs: null,
      videoCompleted: true as const,
      clicks: [
        { clickIndex: 1, videoTimeAtClick: 1.2, responseTimeMs: 4000 },
        { clickIndex: 2, videoTimeAtClick: 2.25, responseTimeMs: 4800 }
      ]
    };

    const saved = await repository.submitResponse(submission);
    assert.deepEqual(saved, {
      attemptId: ATTEMPT_1,
      nextVideoOrder: 2,
      isComplete: false
    });
    const response = db.prepare(
      "SELECT answer, correct, video_time_at_click_ms, detection_latency_ms, no_response_latency_ms FROM local_responses WHERE attempt_id = ? AND video_order = 1"
    ).get(ATTEMPT_1) as Record<string, number | null>;
    assert.deepEqual(response, {
      answer: 1,
      correct: 1,
      video_time_at_click_ms: 1200,
      detection_latency_ms: -300,
      no_response_latency_ms: null
    });
    const events = db.prepare(
      "SELECT click_index, video_time_at_click_ms, detection_latency_ms, overridden, final_valid FROM local_lesion_detection_events WHERE attempt_id = ? ORDER BY click_index"
    ).all(ATTEMPT_1);
    assert.deepEqual(events, [
      {
        click_index: 1,
        video_time_at_click_ms: 1200,
        detection_latency_ms: -300,
        overridden: 0,
        final_valid: 1
      },
      {
        click_index: 2,
        video_time_at_click_ms: 2250,
        detection_latency_ms: 750,
        overridden: 0,
        final_valid: 1
      }
    ]);

    assert.deepEqual(await repository.submitResponse(submission), saved);
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM local_responses").get() as { count: number }).count,
      1
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM local_lesion_detection_events").get() as { count: number }).count,
      2
    );
    await assert.rejects(
      () => repository.submitResponse({ ...submission, responseTimeMs: 5001 }),
      /LOCAL_RESPONSE_CONFLICT/
    );
    db.close();
  });
});

test("stores a no-lesion response without detection time and completes the attempt", async () => {
  await withDirectory(async (directory) => {
    const studyPackage = await createDevPackage(directory);
    const db = openMigrated(path.join(directory, "complete.sqlite"));
    const repository = new LocalAssessmentRepository(
      db,
      repositoryOptions(studyPackage)
    );
    await repository.createOrResumeAttempt({
      participantId: "DEV001",
      sessionNumber: 1
    });
    await repository.submitResponse({
      attemptId: ATTEMPT_1,
      videoOrder: 1,
      answer: true,
      responseTimeMs: 5000,
      noResponseLatencyMs: null,
      videoCompleted: true,
      clicks: [{ clickIndex: 1, videoTimeAtClick: 1.5, responseTimeMs: 4500 }]
    });
    const completed = await repository.submitResponse({
      attemptId: ATTEMPT_1,
      videoOrder: 2,
      answer: false,
      responseTimeMs: 9000,
      noResponseLatencyMs: 275,
      videoCompleted: true,
      clicks: []
    });

    assert.deepEqual(completed, {
      attemptId: ATTEMPT_1,
      nextVideoOrder: 3,
      isComplete: true
    });
    assert.deepEqual(
      db.prepare(
        "SELECT answer, correct, video_time_at_click_ms, detection_latency_ms, no_response_latency_ms FROM local_responses WHERE attempt_id = ? AND video_order = 2"
      ).get(ATTEMPT_1),
      {
        answer: 0,
        correct: 1,
        video_time_at_click_ms: null,
        detection_latency_ms: null,
        no_response_latency_ms: 275
      }
    );
    assert.equal(
      (db.prepare("SELECT status FROM local_assessment_attempts WHERE attempt_id = ?").get(ATTEMPT_1) as { status: string }).status,
      "completed"
    );
    const resumedCompleted = await repository.createOrResumeAttempt({
      participantId: "DEV001",
      sessionNumber: 1
    });
    assert.equal(resumedCompleted.kind, "session");
    assert.deepEqual(
      resumedCompleted.kind === "session"
        ? {
            attemptId: resumedCompleted.session.attemptId,
            status: resumedCompleted.session.status,
            isComplete: resumedCompleted.session.isComplete,
            nextVideoOrder: resumedCompleted.session.nextVideoOrder
          }
        : null,
      {
        attemptId: ATTEMPT_1,
        status: "completed",
        isComplete: true,
        nextVideoOrder: 3
      }
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM local_assessment_attempts").get() as { count: number }).count,
      1
    );
    await assert.rejects(
      () => repository.authorizeCurrentVideo(ATTEMPT_1, 2),
      /not current or is not in progress/
    );
    db.close();
  });
});

test("rolls back response and events when an event insert fails", async () => {
  await withDirectory(async (directory) => {
    const studyPackage = await createDevPackage(directory, 1);
    const db = openMigrated(path.join(directory, "rollback.sqlite"));
    const repository = new LocalAssessmentRepository(
      db,
      repositoryOptions(studyPackage)
    );
    await repository.createOrResumeAttempt({
      participantId: "DEV001",
      sessionNumber: 1
    });
    db.exec(`
      CREATE TRIGGER fail_local_event_insert
      BEFORE INSERT ON local_lesion_detection_events
      BEGIN
        SELECT RAISE(ABORT, 'synthetic event failure');
      END;
    `);

    await assert.rejects(() =>
      repository.submitResponse({
        attemptId: ATTEMPT_1,
        videoOrder: 1,
        answer: true,
        responseTimeMs: 5000,
        noResponseLatencyMs: null,
        videoCompleted: true,
        clicks: [{ clickIndex: 1, videoTimeAtClick: 1, responseTimeMs: 4000 }]
      })
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM local_responses").get() as { count: number }).count,
      0
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM local_lesion_detection_events").get() as { count: number }).count,
      0
    );
    assert.deepEqual(
      await repository.authorizeCurrentVideo(ATTEMPT_1, 1),
      { videoId: "video_001", relativeFilePath: "video_001.mp4" }
    );
    db.close();
  });
});

test("does not advance when the response insert fails", async () => {
  await withDirectory(async (directory) => {
    const studyPackage = await createDevPackage(directory, 1);
    const db = openMigrated(path.join(directory, "response-failure.sqlite"));
    const repository = new LocalAssessmentRepository(
      db,
      repositoryOptions(studyPackage)
    );
    await repository.createOrResumeAttempt({
      participantId: "DEV001",
      sessionNumber: 1
    });
    db.exec(`
      CREATE TRIGGER fail_local_response_insert
      BEFORE INSERT ON local_responses
      BEGIN
        SELECT RAISE(ABORT, 'synthetic response failure');
      END;
    `);

    await assert.rejects(() =>
      repository.submitResponse({
        attemptId: ATTEMPT_1,
        videoOrder: 1,
        answer: false,
        responseTimeMs: 5000,
        noResponseLatencyMs: 100,
        videoCompleted: true,
        clicks: []
      })
    );
    assert.equal(
      (db.prepare("SELECT COUNT(*) AS count FROM local_responses").get() as {
        count: number;
      }).count,
      0
    );
    assert.equal(
      (
        db
          .prepare(
            "SELECT status FROM local_assessment_attempts WHERE attempt_id = ?"
          )
          .get(ATTEMPT_1) as { status: string }
      ).status,
      "in_progress"
    );
    assert.deepEqual(
      await repository.authorizeCurrentVideo(ATTEMPT_1, 1),
      { videoId: "video_001", relativeFilePath: "video_001.mp4" }
    );
    db.close();
  });
});

test("does not advance when SQLite is busy or read-only", async () => {
  await withDirectory(async (directory) => {
    const databasePath = path.join(directory, "write-failure.sqlite");
    const studyPackage = await createDevPackage(directory, 1);
    const setupDb = openMigrated(databasePath);
    const setupRepository = new LocalAssessmentRepository(
      setupDb,
      repositoryOptions(studyPackage)
    );
    await setupRepository.createOrResumeAttempt({
      participantId: "DEV001",
      sessionNumber: 1
    });
    setupDb.close();

    const locker = new Database(databasePath);
    locker.exec("BEGIN IMMEDIATE");
    const busyDb = openMigrated(databasePath);
    busyDb.pragma("busy_timeout = 10");
    const busyRepository = new LocalAssessmentRepository(busyDb);
    const noSubmission = {
      attemptId: ATTEMPT_1,
      videoOrder: 1,
      answer: false,
      responseTimeMs: 5000,
      noResponseLatencyMs: 100,
      videoCompleted: true as const,
      clicks: []
    };

    await assert.rejects(() => busyRepository.submitResponse(noSubmission));
    locker.exec("ROLLBACK");
    locker.close();
    busyDb.close();

    const readOnlyDb = new Database(databasePath, { readonly: true });
    readOnlyDb.pragma("foreign_keys = ON");
    const readOnlyRepository = new LocalAssessmentRepository(readOnlyDb);
    await assert.rejects(() => readOnlyRepository.submitResponse(noSubmission));
    readOnlyDb.close();

    const verifyDb = openMigrated(databasePath);
    assert.equal(
      (verifyDb.prepare("SELECT COUNT(*) AS count FROM local_responses").get() as { count: number }).count,
      0
    );
    verifyDb.close();
  });
});

test("rejects a corrupt sealed package before repository registration", async () => {
  await withDirectory(async (directory) => {
    const studyPackage = await createDevPackage(directory);
    const db = openMigrated(path.join(directory, "corrupt-package.sqlite"));

    assert.throws(
      () =>
        new LocalAssessmentRepository(db, {
          ...repositoryOptions(studyPackage),
          studyPackage: {
            ...studyPackage,
            checksumSha256: "0".repeat(64)
          }
        }),
      /checksum/
    );
    db.close();
  });
});
