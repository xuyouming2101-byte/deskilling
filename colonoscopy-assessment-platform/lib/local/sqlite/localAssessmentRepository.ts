import "server-only";

import { randomInt, randomUUID } from "node:crypto";
import type Database from "better-sqlite3";
import type {
  AssessmentRepository,
  AttemptDetectionClick,
  AttemptSession,
  AttemptVideoSubmission,
  CurrentVideoAuthorizationRepository,
  ParticipantStartInput,
  StartResult,
  SubmitResult
} from "../../assessment/contracts.ts";
import {
  assertLocalStudyPackageSeal,
  type LocalStudyPackageV1,
  type LocalStudyPackageVideoV1
} from "../studyPackage.ts";
import { assertLocalIntegrity } from "./database.ts";
import { CURRENT_LOCAL_SCHEMA_VERSION } from "./schema.ts";

type LocalAssessmentRepositoryOptions = {
  studyPackage?: LocalStudyPackageV1;
  idFactory?: () => string;
  now?: () => string;
  shuffle?: (
    items: readonly LocalStudyPackageVideoV1[]
  ) => LocalStudyPackageVideoV1[];
};

type AttemptRow = {
  attempt_id: string;
  participant_id: string;
  session_number: 1 | 2 | 3;
  status: "in_progress" | "completed" | "abandoned" | "invalid";
};

type QueueMetadataRow = {
  participant_id: string;
  session_number: 1 | 2 | 3;
  video_id: string;
  video_order: number;
  file_path: string;
  has_lesion: number;
  lesion_onset_ms: number | null;
};

type StoredResponseComparable = {
  participant_id: string;
  session_number: number;
  video_id: string;
  video_order: number;
  answer: number;
  correct: number;
  response_time_ms: number;
  video_time_at_click_ms: number | null;
  detection_latency_ms: number | null;
  response_type: string;
  video_completed: number;
  no_response_latency_ms: number | null;
};

type StoredEventComparable = {
  participant_id: string;
  session_number: number;
  video_id: string;
  video_order: number;
  click_index: number;
  video_time_at_click_ms: number;
  response_time_ms: number;
  lesion_onset_ms: number | null;
  detection_latency_ms: number | null;
  overridden: number;
  final_valid: number;
};

function secureShuffle(
  items: readonly LocalStudyPackageVideoV1[]
): LocalStudyPackageVideoV1[] {
  const shuffled = [...items];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index]
    ];
  }

  return shuffled;
}

function isSessionNumber(value: number): value is 1 | 2 | 3 {
  return value === 1 || value === 2 || value === 3;
}

function assertStartInput(input: ParticipantStartInput): void {
  if (!input.participantId || input.participantId.trim() !== input.participantId) {
    throw new Error("Participant ID is invalid.");
  }

  if (!isSessionNumber(input.sessionNumber)) {
    throw new Error("Session number must be 1, 2, or 3.");
  }

  if (input.attemptId !== undefined && input.attemptId.length === 0) {
    throw new Error("Attempt ID is invalid.");
  }
}

function assertNonnegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a nonnegative integer.`);
  }
}

function normalizeClicks(
  clicks: readonly AttemptDetectionClick[]
): Array<AttemptDetectionClick & { videoTimeAtClickMs: number }> {
  return clicks.map((click, index) => {
    if (click.clickIndex !== index + 1) {
      throw new Error("Lesion click indexes must be contiguous from 1.");
    }

    if (
      !Number.isFinite(click.videoTimeAtClick) ||
      click.videoTimeAtClick < 0
    ) {
      throw new Error("Lesion click video time is invalid.");
    }

    assertNonnegativeInteger(click.responseTimeMs, "Click response time");

    return {
      ...click,
      videoTimeAtClickMs: Math.round(click.videoTimeAtClick * 1000)
    };
  });
}

function recordsEqual<T extends Record<string, unknown>>(
  left: T,
  right: T
): boolean {
  const keys = Object.keys(left) as Array<keyof T>;
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => Object.is(left[key], right[key]))
  );
}

export class LocalAssessmentRepository
  implements AssessmentRepository, CurrentVideoAuthorizationRepository
{
  private readonly db: Database.Database;
  private readonly studyPackage: LocalStudyPackageV1 | null;
  private readonly idFactory: () => string;
  private readonly now: () => string;
  private readonly shuffle: (
    items: readonly LocalStudyPackageVideoV1[]
  ) => LocalStudyPackageVideoV1[];

  constructor(
    db: Database.Database,
    options: LocalAssessmentRepositoryOptions = {}
  ) {
    this.db = db;
    this.studyPackage = options.studyPackage
      ? assertLocalStudyPackageSeal(options.studyPackage)
      : null;
    this.idFactory = options.idFactory ?? randomUUID;
    this.now = options.now ?? (() => new Date().toISOString());
    this.shuffle = options.shuffle ?? secureShuffle;

    if (this.studyPackage) {
      this.registerStudyPackage(this.studyPackage);
    }
  }

  private registerStudyPackage(studyPackage: LocalStudyPackageV1): void {
    const packageJson = JSON.stringify(studyPackage);
    const participantIdsJson = JSON.stringify(
      studyPackage.allowedParticipantIds
    );

    this.db
      .prepare(
        `INSERT INTO local_study_packages
          (checksum_sha256, package_version, minimum_schema_version, study_mode,
           generated_at, allowed_participant_ids_json, canonical_manifest_json,
           registered_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(checksum_sha256) DO NOTHING`
      )
      .run(
        studyPackage.checksumSha256,
        studyPackage.packageVersion,
        studyPackage.minimumSchemaVersion,
        studyPackage.studyMode,
        studyPackage.generatedAt,
        participantIdsJson,
        packageJson,
        this.now()
      );

    const stored = this.db
      .prepare(
        `SELECT canonical_manifest_json
         FROM local_study_packages
         WHERE checksum_sha256 = ?`
      )
      .get(studyPackage.checksumSha256) as
      | { canonical_manifest_json: string }
      | undefined;

    if (!stored || stored.canonical_manifest_json !== packageJson) {
      throw new Error("Stored LOCAL study package does not match its checksum.");
    }
  }

  private loadAttempt(attemptId: string): AttemptRow | null {
    return (
      (this.db
        .prepare(
          `SELECT attempt_id, participant_id, session_number, status
           FROM local_assessment_attempts
           WHERE attempt_id = ?`
        )
        .get(attemptId) as AttemptRow | undefined) ?? null
    );
  }

  private loadSession(attemptId: string): AttemptSession {
    const attempt = this.loadAttempt(attemptId);

    if (!attempt) {
      throw new Error("LOCAL attempt was not found.");
    }

    const queue = this.db
      .prepare(
        `SELECT video_id, video_order
         FROM local_assessment_queue
         WHERE attempt_id = ?
         ORDER BY video_order`
      )
      .all(attemptId) as Array<{ video_id: string; video_order: number }>;
    const answeredOrders = new Set(
      (
        this.db
          .prepare(
            "SELECT video_order FROM local_responses WHERE attempt_id = ?"
          )
          .all(attemptId) as Array<{ video_order: number }>
      ).map((row) => row.video_order)
    );
    const firstUnanswered = queue.find(
      (item) => !answeredOrders.has(item.video_order)
    );
    const nextVideoOrder = firstUnanswered?.video_order ?? queue.length + 1;
    const isComplete = attempt.status === "completed";

    return {
      attemptId: attempt.attempt_id,
      participantId: attempt.participant_id,
      sessionNumber: attempt.session_number,
      status: attempt.status,
      queue: queue.map((item) => ({
        videoId: item.video_id,
        videoOrder: item.video_order
      })),
      nextVideoOrder,
      isComplete
    };
  }

  private createAttempt(input: ParticipantStartInput): AttemptSession {
    const studyPackage = this.studyPackage;

    if (!studyPackage) {
      throw new Error("A validated LOCAL study package is required to start.");
    }

    if (
      studyPackage.studyMode === "formal" &&
      !studyPackage.allowedParticipantIds.includes(input.participantId)
    ) {
      throw new Error(
        "Participant ID is not in the sealed FORMAL participant roster."
      );
    }

    if (studyPackage.studyMode === "formal") {
      assertLocalIntegrity(this.db);
    }

    const eligibleVideos = studyPackage.videos.filter((video) =>
      studyPackage.studyMode === "dev"
        ? video.isTest
        : !video.isTest && video.sessionPool === input.sessionNumber
    );

    if (
      eligibleVideos.length === 0 ||
      (studyPackage.studyMode === "formal" && eligibleVideos.length !== 40)
    ) {
      throw new Error("The sealed package has no valid pool for this session.");
    }

    const attemptId = this.idFactory();
    const createdAt = this.now();
    const queue = this.shuffle(eligibleVideos);

    const create = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO local_assessment_attempts
            (attempt_id, participant_id, session_number, runtime_channel,
             study_mode, status, valid_for_analysis, replaces_attempt_id,
             started_at, completed_at, sync_state, sync_payload_sha256,
             study_package_checksum, schema_version, created_at, updated_at)
           VALUES (?, ?, ?, 'local', ?, 'in_progress', 0, NULL,
                   ?, NULL, 'never_synced', NULL, ?, ?, ?, ?)`
        )
        .run(
          attemptId,
          input.participantId,
          input.sessionNumber,
          studyPackage.studyMode,
          createdAt,
          studyPackage.checksumSha256,
          CURRENT_LOCAL_SCHEMA_VERSION,
          createdAt,
          createdAt
        );

      const insertMetadata = this.db.prepare(
        `INSERT INTO local_video_metadata_snapshot
          (attempt_id, participant_id, session_number, video_id, file_path,
           has_lesion, lesion_onset_ms, is_test, session_pool,
           file_size_bytes, file_sha256)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const insertQueue = this.db.prepare(
        `INSERT INTO local_assessment_queue
          (attempt_id, participant_id, session_number, video_id, video_order,
           created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );

      for (const video of eligibleVideos) {
        insertMetadata.run(
          attemptId,
          input.participantId,
          input.sessionNumber,
          video.videoId,
          video.filePath,
          video.hasLesion ? 1 : 0,
          video.lesionOnsetSec === null
            ? null
            : Math.round(video.lesionOnsetSec * 1000),
          video.isTest ? 1 : 0,
          video.sessionPool,
          video.fileSizeBytes,
          video.fileSha256
        );
      }

      queue.forEach((video, index) => {
        insertQueue.run(
          attemptId,
          input.participantId,
          input.sessionNumber,
          video.videoId,
          index + 1,
          createdAt
        );
      });
    });

    create();
    return this.loadSession(attemptId);
  }

  async createOrResumeAttempt(
    input: ParticipantStartInput
  ): Promise<StartResult> {
    assertStartInput(input);

    if (input.attemptId) {
      const attempt = this.loadAttempt(input.attemptId);

      if (
        !attempt ||
        attempt.participant_id !== input.participantId ||
        attempt.session_number !== input.sessionNumber
      ) {
        throw new Error("LOCAL attempt does not match participant and session.");
      }

      return { kind: "session", session: this.loadSession(input.attemptId) };
    }

    const inProgress = this.db
      .prepare(
        `SELECT attempt_id
         FROM local_assessment_attempts
         WHERE participant_id = ? AND session_number = ? AND status = 'in_progress'
         ORDER BY attempt_id`
      )
      .all(input.participantId, input.sessionNumber) as Array<{
      attempt_id: string;
    }>;

    if (inProgress.length === 1) {
      return {
        kind: "session",
        session: this.loadSession(inProgress[0].attempt_id)
      };
    }

    if (inProgress.length > 1) {
      return {
        kind: "attempt_choice_required",
        attempts: inProgress.map((row) => this.loadSession(row.attempt_id))
      };
    }

    const latestCompleted = this.db
      .prepare(
        `SELECT attempt_id
         FROM local_assessment_attempts
         WHERE participant_id = ? AND session_number = ? AND status = 'completed'
         ORDER BY completed_at DESC, created_at DESC, attempt_id DESC
         LIMIT 1`
      )
      .get(input.participantId, input.sessionNumber) as
      | { attempt_id: string }
      | undefined;

    if (latestCompleted) {
      return {
        kind: "session",
        session: this.loadSession(latestCompleted.attempt_id)
      };
    }

    return { kind: "session", session: this.createAttempt(input) };
  }

  async markAttemptAbandoned(attemptId: string): Promise<void> {
    const result = this.db
      .prepare(
        `UPDATE local_assessment_attempts
         SET status = 'abandoned', updated_at = ?
         WHERE attempt_id = ? AND status = 'in_progress'`
      )
      .run(this.now(), attemptId);

    if (result.changes !== 1) {
      throw new Error("Only an in-progress LOCAL attempt can be abandoned.");
    }
  }

  private currentVideoOrder(attemptId: string): number | null {
    const row = this.db
      .prepare(
        `SELECT MIN(q.video_order) AS video_order
         FROM local_assessment_queue q
         LEFT JOIN local_responses r
           ON r.attempt_id = q.attempt_id
          AND r.video_order = q.video_order
         WHERE q.attempt_id = ? AND r.attempt_id IS NULL`
      )
      .get(attemptId) as { video_order: number | null };

    return row.video_order;
  }

  async authorizeCurrentVideo(
    attemptId: string,
    videoOrder: number
  ): Promise<{ videoId: string; relativeFilePath: string }> {
    const attempt = this.loadAttempt(attemptId);
    const currentOrder = attempt?.status === "in_progress"
      ? this.currentVideoOrder(attemptId)
      : null;

    if (!attempt || currentOrder === null || currentOrder !== videoOrder) {
      throw new Error("LOCAL video is not current or is not in progress.");
    }

    const row = this.db
      .prepare(
        `SELECT q.video_id, m.file_path
         FROM local_assessment_queue q
         JOIN local_video_metadata_snapshot m
           ON m.attempt_id = q.attempt_id AND m.video_id = q.video_id
         WHERE q.attempt_id = ? AND q.video_order = ?`
      )
      .get(attemptId, videoOrder) as
      | { video_id: string; file_path: string }
      | undefined;

    if (!row) {
      throw new Error("LOCAL current video metadata is missing.");
    }

    return { videoId: row.video_id, relativeFilePath: row.file_path };
  }

  private comparableSubmission(
    submission: AttemptVideoSubmission,
    metadata: QueueMetadataRow
  ): {
    response: StoredResponseComparable;
    events: StoredEventComparable[];
  } {
    if (submission.videoCompleted !== true) {
      throw new Error("LOCAL response requires completed video playback.");
    }

    if (typeof submission.answer !== "boolean") {
      throw new Error("LOCAL response answer is invalid.");
    }

    assertNonnegativeInteger(submission.responseTimeMs, "Response time");
    const clicks = normalizeClicks(submission.clicks);

    if (submission.answer) {
      if (clicks.length === 0 || submission.noResponseLatencyMs !== null) {
        throw new Error("A lesion response requires marks and no no-response latency.");
      }
    } else {
      if (clicks.length !== 0 || submission.noResponseLatencyMs === null) {
        throw new Error("A no-lesion response requires no marks and a no-response latency.");
      }

      assertNonnegativeInteger(
        submission.noResponseLatencyMs,
        "No-response latency"
      );
    }

    const firstClick = clicks[0] ?? null;
    const firstDetectionLatency =
      firstClick && metadata.lesion_onset_ms !== null
        ? firstClick.videoTimeAtClickMs - metadata.lesion_onset_ms
        : null;
    const common = {
      participant_id: metadata.participant_id,
      session_number: metadata.session_number,
      video_id: metadata.video_id,
      video_order: metadata.video_order
    };

    return {
      response: {
        ...common,
        answer: submission.answer ? 1 : 0,
        correct: Number(submission.answer === Boolean(metadata.has_lesion)),
        response_time_ms: submission.responseTimeMs,
        video_time_at_click_ms: submission.answer
          ? firstClick?.videoTimeAtClickMs ?? null
          : null,
        detection_latency_ms: submission.answer
          ? firstDetectionLatency
          : null,
        response_type: submission.answer
          ? "lesion_detected"
          : "no_lesion_detected",
        video_completed: 1,
        no_response_latency_ms: submission.answer
          ? null
          : submission.noResponseLatencyMs
      },
      events: submission.answer
        ? clicks.map((click) => ({
            ...common,
            click_index: click.clickIndex,
            video_time_at_click_ms: click.videoTimeAtClickMs,
            response_time_ms: click.responseTimeMs,
            lesion_onset_ms: metadata.lesion_onset_ms,
            detection_latency_ms:
              metadata.lesion_onset_ms === null
                ? null
                : click.videoTimeAtClickMs - metadata.lesion_onset_ms,
            overridden: 0,
            final_valid: 1
          }))
        : []
    };
  }

  private isExactDuplicate(
    attemptId: string,
    expectedResponse: StoredResponseComparable,
    expectedEvents: StoredEventComparable[]
  ): boolean {
    const storedResponse = this.db
      .prepare(
        `SELECT participant_id, session_number, video_id, video_order, answer,
                correct, response_time_ms, video_time_at_click_ms,
                detection_latency_ms, response_type, video_completed,
                no_response_latency_ms
         FROM local_responses
         WHERE attempt_id = ? AND video_order = ?`
      )
      .get(attemptId, expectedResponse.video_order) as
      | StoredResponseComparable
      | undefined;

    if (!storedResponse || !recordsEqual(storedResponse, expectedResponse)) {
      return false;
    }

    const storedEvents = this.db
      .prepare(
        `SELECT participant_id, session_number, video_id, video_order,
                click_index, video_time_at_click_ms, response_time_ms,
                lesion_onset_ms, detection_latency_ms, overridden, final_valid
         FROM local_lesion_detection_events
         WHERE attempt_id = ? AND video_order = ?
         ORDER BY click_index`
      )
      .all(attemptId, expectedResponse.video_order) as StoredEventComparable[];

    return (
      storedEvents.length === expectedEvents.length &&
      storedEvents.every((event, index) =>
        recordsEqual(event, expectedEvents[index])
      )
    );
  }

  private submitResult(attemptId: string): SubmitResult {
    const session = this.loadSession(attemptId);
    return {
      attemptId,
      nextVideoOrder: session.nextVideoOrder,
      isComplete: session.isComplete
    };
  }

  async submitResponse(
    submission: AttemptVideoSubmission
  ): Promise<SubmitResult> {
    const attempt = this.loadAttempt(submission.attemptId);

    if (!attempt) {
      throw new Error("LOCAL attempt was not found.");
    }

    const metadata = this.db
      .prepare(
        `SELECT q.participant_id, q.session_number, q.video_id, q.video_order,
                m.file_path, m.has_lesion, m.lesion_onset_ms
         FROM local_assessment_queue q
         JOIN local_video_metadata_snapshot m
           ON m.attempt_id = q.attempt_id AND m.video_id = q.video_id
         WHERE q.attempt_id = ? AND q.video_order = ?`
      )
      .get(submission.attemptId, submission.videoOrder) as
      | QueueMetadataRow
      | undefined;

    if (!metadata) {
      throw new Error("LOCAL response does not match the persisted queue.");
    }

    const comparable = this.comparableSubmission(submission, metadata);
    const existing = this.db
      .prepare(
        "SELECT 1 AS present FROM local_responses WHERE attempt_id = ? AND video_order = ?"
      )
      .get(submission.attemptId, submission.videoOrder);

    if (existing) {
      if (
        this.isExactDuplicate(
          submission.attemptId,
          comparable.response,
          comparable.events
        )
      ) {
        return this.submitResult(submission.attemptId);
      }

      throw new Error("LOCAL_RESPONSE_CONFLICT: stored response differs.");
    }

    if (attempt.status !== "in_progress") {
      throw new Error("LOCAL attempt is read-only after terminal status.");
    }

    const currentOrder = this.currentVideoOrder(submission.attemptId);

    if (currentOrder !== submission.videoOrder) {
      throw new Error("LOCAL response is not for the current video order.");
    }

    const createdAt = this.now();
    const commit = this.db.transaction(() => {
      const response = comparable.response;
      this.db
        .prepare(
          `INSERT INTO local_responses
            (attempt_id, participant_id, session_number, video_id, video_order,
             answer, correct, response_time_ms, created_at,
             video_time_at_click_ms, detection_latency_ms, response_type,
             video_completed, no_response_latency_ms)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          submission.attemptId,
          response.participant_id,
          response.session_number,
          response.video_id,
          response.video_order,
          response.answer,
          response.correct,
          response.response_time_ms,
          createdAt,
          response.video_time_at_click_ms,
          response.detection_latency_ms,
          response.response_type,
          response.video_completed,
          response.no_response_latency_ms
        );

      const insertEvent = this.db.prepare(
        `INSERT INTO local_lesion_detection_events
          (attempt_id, participant_id, session_number, video_id, video_order,
           click_index, video_time_at_click_ms, response_time_ms,
           lesion_onset_ms, detection_latency_ms, overridden, final_valid,
           created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      for (const event of comparable.events) {
        insertEvent.run(
          submission.attemptId,
          event.participant_id,
          event.session_number,
          event.video_id,
          event.video_order,
          event.click_index,
          event.video_time_at_click_ms,
          event.response_time_ms,
          event.lesion_onset_ms,
          event.detection_latency_ms,
          event.overridden,
          event.final_valid,
          createdAt
        );
      }

      const counts = this.db
        .prepare(
          `SELECT
             (SELECT COUNT(*) FROM local_assessment_queue WHERE attempt_id = ?) AS queue_count,
             (SELECT COUNT(*) FROM local_responses WHERE attempt_id = ?) AS response_count`
        )
        .get(submission.attemptId, submission.attemptId) as {
        queue_count: number;
        response_count: number;
      };

      if (counts.queue_count === counts.response_count) {
        this.db
          .prepare(
            `UPDATE local_assessment_attempts
             SET status = 'completed', completed_at = ?, updated_at = ?
             WHERE attempt_id = ? AND status = 'in_progress'`
          )
          .run(createdAt, createdAt, submission.attemptId);
      } else {
        this.db
          .prepare(
            "UPDATE local_assessment_attempts SET updated_at = ? WHERE attempt_id = ?"
          )
          .run(createdAt, submission.attemptId);
      }
    });

    commit();
    return this.submitResult(submission.attemptId);
  }
}
