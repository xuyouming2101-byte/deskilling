# Local and Online Authentication, Attempts, and Video Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a genuinely usable, fully offline LOCAL emergency assessment system before making invasive live Supabase changes, then add attempt-aware synchronization, ONLINE participant authentication, and an explicitly approved release path.

**Architecture:** LOCAL uses server-controlled mode, a sealed study package, SQLite-native attempts, and current-order-authorized filesystem streaming; it can start, resume, and complete formal 40-video assessments without Supabase or Internet. ONLINE continues using Supabase and private Storage until a later, fully audited attempt migration and Auth release. Shared player components consume source-neutral repository and video contracts, while study mode is always selected by trusted package/server configuration rather than participant input.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 5.8, SurveyJS Form Library 2.5, Node.js 22, `better-sqlite3@13.0.3`, `@types/better-sqlite3@9.6.0`, `canonicalize@4.0.0`, Supabase PostgreSQL/Auth/Storage/Edge Functions, Node test runner, Playwright.

**Spec:** `docs/superpowers/specs/2026-08-29-local-online-auth-video-design.md`, with the sequencing corrections approved after the original plan.

## Global Constraints

- `main` is the development branch. `release` and the running ECS remain unchanged through Phases 0A-6.
- Use inline `superpowers:executing-plans`; do not dispatch new subagents or per-task reviewer agents.
- Complete one phase, its focused tests, standard gates, review checkpoint, and approval before starting the next phase.
- Phase 0A performs only the lightweight live reads needed to reproduce current study semantics locally. It performs zero database writes.
- Uncertain live migration history does not block LOCAL development, LOCAL study-package work, local-video streaming, SQLite collection, or the fully offline Phase 3 system.
- `BLOCKED_BY_ENVIRONMENT` blocks live Supabase migration, synchronization deployment, and ONLINE Auth deployment. It does not block Phases 1-3.
- No live Supabase migration is a prerequisite for Phases 1-3.
- LOCAL active collection never calls Supabase or private Storage and never falls back to them.
- ONLINE never reads LOCAL SQLite or local video files and never falls back to them.
- `ASSESSMENT_DEPLOYMENT_MODE` is server-only and must be exactly `local` or `online`; missing or invalid values fail closed.
- Participant/browser assessment input never contains or controls `studyMode`/`study_mode`.
- LOCAL study mode comes from the sealed package selected through server-only `LOCAL_STUDY_PACKAGE_PATH`.
- ONLINE study mode comes from trusted database/server configuration.
- FORMAL LOCAL participant IDs must match the approved coded-ID roster sealed into the study package. The package never contains passwords.
- The ONLINE account pool must use exactly the same coded participant IDs as the approved FORMAL LOCAL roster.
- Preserve existing video, queue, response, event, timing, mark, player, resume, completion, and analysis meanings.
- Never delete or silently rewrite existing `videos`, `assessment_queue`, `responses`, or `lesion_detection_events` rows.
- Use exact path staging because unrelated uncommitted work already exists in the repository.
- Every phase gate runs focused tests plus `npm run typecheck`, `npm test`, and `npm run build`.
- No CI/CD, webhook, automatic deployment, automatic `main -> release` promotion, or automatic synchronization.

## Dependency Graph

```text
Phase 0A lightweight read-only semantics snapshot
  |-- useful input for a real sealed package
  `-- uncertainty does not block LOCAL implementation

Phase 1 shared contracts + local video primitives
  -> Phase 2 SQLite + sealed package + native local attempts
      -> Phase 3 complete offline LOCAL experiment
          -> usable emergency experimental system achieved

Phase 4 full live preflight
  -> restored-copy migration rehearsal
  -> separately approved attempt-aware live migration
      -> Phase 5 LOCAL-to-Supabase sync deployment
      -> Phase 6 ONLINE account pool + Supabase Auth deployment
          -> Phase 7 separately approved manual release
```

Phases 1-3 depend only on repository code, local fixtures/package files, SQLite, and local MP4 files. They do not depend on `assessment_attempts`, attempt-aware live RPCs, a live migration, Supabase connectivity, or ECS.

## Phase Gates

| Gate | Required evidence | Stop condition |
| --- | --- | --- |
| P0A | Read-only schema/semantic snapshot or explicit list of missing live evidence | Missing/uncertain evidence is recorded but LOCAL implementation continues; real FORMAL package sealing waits for required metadata |
| P1 | Fail-closed mode, source-neutral contracts, path containment, Range/206 route | No Supabase migration or persistence dependency allowed |
| P2 | Durable SQLite attempt lifecycle plus validated sealed package and participant roster | No browser-controlled study mode; no unknown FORMAL participant ID |
| P3 | New 40-video FORMAL attempt completes and resumes with network disabled | LOCAL emergency system must be operational before Phase 4 |
| P4A | Exhaustive live audit maps catalogs, data integrity, functions, permissions, Storage, Edge Functions, and migration history | Ambiguity yields `BLOCKED_BY_ENVIRONMENT`; LOCAL remains usable |
| P4B | Backup, restored-copy rehearsal, unchanged-release compatibility proof | No live migration without separate explicit approval |
| P4C | Approved migration post-check and unchanged ECS-release smoke test | Sync/Auth deployment remains blocked on failure |
| P5 | Atomic/idempotent sync and conflict/validity cases pass | No partial import or silent overwrite |
| P6 | Participant Auth ownership and private-video flow pass | Do not modify `release` or ECS |
| P7 | Explicitly approved commit set and recorded rollback SHA | Manual promotion/deployment only |

## Planned File Map

### Phase 0A

- Create `scripts/local-study/lightweight-live-snapshot.sql`: narrowly scoped, read-only study-semantics queries.
- Create `scripts/local-study/validate-lightweight-snapshot.mjs`: required-section/schema validator.
- Create `scripts/local-study/lightweight-live-snapshot.test.mjs`: sanitized fixture tests.
- Modify `.gitignore`: exclude raw snapshots, packages, rosters, SQLite files, WAL files, dumps, and credential exports.
- Create `docs/superpowers/audits/2026-08-29-lightweight-live-study-semantics.md`: sanitized P0A outcome.

### Phases 1-3 LOCAL

- Create `lib/runtime/deploymentMode.ts` and test.
- Create `lib/assessment/contracts.ts` and test.
- Create `lib/assessment/assessmentRepositoryFactory.ts`.
- Create `lib/video/contracts.ts`, `rangeRequest.ts`, `localPath.ts`, and tests.
- Create `lib/video/localVideoAccessGateway.ts`.
- Create `app/api/local/attempts/[attemptId]/videos/[videoOrder]/route.ts` and test.
- Modify `package.json`, `package-lock.json`, and `next.config.mjs` for pinned SQLite/canonicalization support.
- Create `lib/local/sqlite/database.ts`, `schema.ts`, `localAssessmentRepository.ts`, and tests.
- Create `lib/local/studyPackage.ts` and test.
- Create `scripts/local-study/build-package.mjs` and `validate-package.mjs`.
- Create `app/api/local/attempts/route.ts`.
- Create `app/api/local/attempts/[attemptId]/responses/route.ts`.
- Create `app/api/local/attempts/[attemptId]/abandon/route.ts`.
- Create source-neutral `app/api/assessment/start/route.ts`, `response/route.ts`, and `video/route.ts`.
- Modify `app/page.tsx`, `components/AssessmentClient.tsx`, `AssessmentVideoPlayer.tsx`, `LesionSurvey.tsx`, and current tests.
- Create `.env.local.example` without credentials or real operator paths.

### Phase 4 Supabase audit and migration

- Create `scripts/supabase/live-preflight.sql`, `verify-preflight-report.mjs`, `compare-live-repository.mjs`, and tests.
- Create `docs/superpowers/audits/2026-08-29-live-supabase-preflight.md`.
- Create migration files only through `supabase migration new` after a safe P4A verdict.
- Create `supabase/fixtures/legacy-live-shape.sql` and `supabase/assessment_attempts.contract.test.mjs`.

### Phase 5 synchronization

- Create `lib/sync/canonicalPayload.ts`, `localAttemptExporter.ts`, `syncClient.ts`, and tests.
- Create `scripts/local-study/sync-terminal-attempt.mjs`.
- Create a service-role-only sync migration through the Supabase CLI.
- Create `supabase/local_attempt_sync.contract.test.mjs`.

### Phase 6 ONLINE Auth

- Create private account/rate-limit and authenticated v2 RPC migrations through the Supabase CLI.
- Create `scripts/online/provision-participant-accounts.mjs` and tests.
- Create `supabase/functions/participant-sign-in/`.
- Create `supabase/functions/issue-assessment-video-url-v2/`.
- Create `lib/supabase/browserClient.ts`, `lib/online/onlineAssessmentRepository.ts`, and `lib/online/remoteVideoAccessGateway.ts`.
- Modify participant intake and ONLINE authentication tests.

### Phase 7 documentation/release

- Modify `.env.production.example`, `README.md`, `docs/environment-and-release-workflow.md`, and `docs/alibaba-ecs-deployment.md` only when matching behavior is complete and approved.
- Never commit real `.env.local`, `.env.production.local`, package manifests, participant rosters, SQLite files, videos, passwords, service keys, dumps, or signed URLs.

---

## Phase 0A: Lightweight Read-Only Current-State Snapshot

### Task 1: Add the narrow live-semantics snapshot

**Files:**
- Create: `scripts/local-study/lightweight-live-snapshot.sql`
- Create: `scripts/local-study/validate-lightweight-snapshot.mjs`
- Create: `scripts/local-study/lightweight-live-snapshot.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: an authenticated read-only SQL channel when available.
- Produces: `artifacts/local-study-snapshot/current-study-semantics.ndjson` with no row-level participant/response data.

- [ ] **Step 1: Protect local research artifacts**

Add exact ignore entries for:

```gitignore
artifacts/local-study-snapshot/
artifacts/supabase-preflight/
*.sqlite
*.sqlite-shm
*.sqlite-wal
*.study-package.json
*.participant-roster.csv
*.supabase-preflight.dump
```

- [ ] **Step 2: Write a read-only SQL snapshot**

Use `BEGIN TRANSACTION READ ONLY`, statement/lock timeouts, schema-qualified `SELECT` statements, and `ROLLBACK`. Inspect only:

```text
public.videos columns/defaults and required metadata fields
public.assessment_queue columns/defaults
public.responses columns/defaults/check constraints
public.lesion_detection_events columns/defaults/check constraints
public.assessment_runtime_config current DEV/FORMAL value
currently relevant start/resume, submit, next-order, and video-authorization RPC names/signatures/results
```

For `videos`, capture the presence/type/nullable status of `video_id`, `bucket`, `file_path`, `has_lesion`, `lesion_onset_sec`, `is_test`, and `session_pool`. Capture grouped pool/test counts, but not raw ground truth in the committed audit. Perform zero writes and do not inspect exhaustive grants, migration history, unrelated schemas, or all deployed Edge Functions in P0A.

- [ ] **Step 3: Validate snapshot completeness**

The validator must classify each required field/signature as `present`, `missing`, or `unknown`, reject secrets/signed URLs/participant rows, and print `database_writes_performed: 0`.

```bash
node --test scripts/local-study/lightweight-live-snapshot.test.mjs
node scripts/local-study/validate-lightweight-snapshot.mjs artifacts/local-study-snapshot/current-study-semantics.ndjson
```

- [ ] **Step 4: Collect when a read-only channel is available**

Discover current Supabase MCP/CLI/`psql` capabilities through official help/docs rather than guessing. If no safe read channel exists, record `LIGHTWEIGHT_LIVE_SNAPSHOT_INCOMPLETE`; continue Phases 1-3 using synthetic fixtures. Do not create a production FORMAL package until its required video metadata is obtained and verified.

### Task 2: Record the P0A semantic boundary

**Files:**
- Create: `docs/superpowers/audits/2026-08-29-lightweight-live-study-semantics.md`

**Interfaces:**
- Produces: the LOCAL field/RPC contract evidence and one of:

```text
LOCAL_SEMANTICS_SNAPSHOT_READY
LIGHTWEIGHT_LIVE_SNAPSHOT_INCOMPLETE
```

- [ ] **Step 1: Document exact observed semantics**

Record required columns/types, current DEV/FORMAL authority, relevant RPC signatures, pool counts, raw snapshot SHA-256, missing evidence, and `database_writes_performed: 0`. Do not claim which repository migration produced the live state.

- [ ] **Step 2: Apply the non-blocking rule**

Uncertain migration history or incomplete broad environment characterization is not a LOCAL blocker. It is carried forward as a mandatory Phase 4 blocker for live migration, sync deployment, and Auth deployment.

- [ ] **Step 3: Commit only P0A tooling/audit**

Use exact paths and verify the staged diff. Stop for the P0A review checkpoint; approval permits Phase 1 LOCAL work only.

---

## Phase 1: Shared Runtime Contracts and LOCAL Video Primitives

### Task 3: Add fail-closed deployment mode and source-neutral contracts

**Files:**
- Create: `lib/runtime/deploymentMode.ts`
- Create: `lib/runtime/deploymentMode.test.ts`
- Create: `lib/assessment/contracts.ts`
- Create: `lib/assessment/contracts.test.ts`
- Create: `lib/assessment/assessmentRepositoryFactory.ts`
- Create: `lib/video/contracts.ts`
- Modify: `app/page.tsx`

**Interfaces:**
- Produces:

```ts
export type DeploymentMode = "local" | "online";
export type SessionNumber = 1 | 2 | 3;
export type ParticipantStartInput = {
  participantId: string;
  sessionNumber: SessionNumber;
  attemptId?: string;
};
export type AttemptQueueItem = { videoId: string; videoOrder: number };
export type AttemptStatus = "in_progress" | "completed" | "abandoned" | "invalid";
export type AttemptSession = {
  attemptId: string;
  participantId: string;
  sessionNumber: SessionNumber;
  status: AttemptStatus;
  queue: readonly AttemptQueueItem[];
  nextVideoOrder: number;
  isComplete: boolean;
};
export type StartResult =
  | { kind: "session"; session: AttemptSession }
  | { kind: "attempt_choice_required"; attempts: readonly AttemptSession[] };
export interface AssessmentRepository {
  createOrResumeAttempt(input: ParticipantStartInput): Promise<StartResult>;
  submitResponse(submission: AttemptVideoSubmission): Promise<SubmitResult>;
  markAttemptAbandoned(attemptId: string): Promise<void>;
}
export interface CurrentVideoAuthorizationRepository {
  authorizeCurrentVideo(attemptId: string, videoOrder: number): Promise<{
    videoId: string;
    relativeFilePath: string;
  }>;
}
export interface VideoAccessGateway {
  getCurrentVideo(input: { attemptId: string; videoOrder: number }): Promise<{
    attemptId: string;
    videoId: string;
    videoOrder: number;
    url: string;
    expiresAt: string | null;
  }>;
}
```

`AttemptVideoSubmission` retains current answer, response-time, no-response-latency, video-completed, and click fields plus `attemptId`; participant ID, session, correctness, lesion onset, and detection latency are resolved/validated by the trusted repository context.

- [ ] **Step 1: Test server-only mode**

Only exact `local`/`online` values pass. Missing/invalid values, hostname/port/branch inference, browser query/header/cookie flags, and mixed case fail. Every server route rechecks the mode.

- [ ] **Step 2: Test participant input boundaries**

Assert `ParticipantStartInput` and browser payload parsing accept only participant ID, Session 1/2/3, and optional attempt ID. Explicitly reject `studyMode`, `study_mode`, `is_test`, `session_pool`, and ground-truth fields.

- [ ] **Step 3: Implement the contracts without live Supabase changes**

Use `import "server-only"` for mode/factory modules. Factories may use test doubles in Phase 1; no live attempt-aware Supabase repository is required.

### Task 4: Implement path containment and Range parsing

**Files:**
- Create: `lib/video/rangeRequest.ts`
- Create: `lib/video/rangeRequest.test.ts`
- Create: `lib/video/localPath.ts`
- Create: `lib/video/localPath.test.ts`

**Interfaces:**
- Produces:

```ts
export type ByteRange = { start: number; end: number; length: number };
export function parseSingleRange(header: string | null, size: number): ByteRange | null;
export async function resolveAuthorizedMp4(root: string, relativePath: string): Promise<string>;
```

- [ ] **Step 1: Test Range behavior**

Cover no range, start-end, open-ended, suffix, last byte, malformed unit, empty/reversed/multiple ranges, zero-size file, out-of-bounds start, and zero suffix. Invalid or unsatisfiable ranges produce a typed 416 error with exact file size.

- [ ] **Step 2: Test path containment**

Reject empty, absolute, NUL, dot/traversal, encoded traversal after route decoding, non-MP4, directory, missing file, and symlink escaping the real root. Allow a regular readable MP4 and an internal symlink only when its real target remains under the real root.

- [ ] **Step 3: Implement and run focused tests**

```bash
node --test lib/video/rangeRequest.test.ts lib/video/localPath.test.ts
npm run typecheck
```

### Task 5: Add a LOCAL-only authorized streaming route

**Files:**
- Create: `lib/video/localVideoAccessGateway.ts`
- Create: `app/api/local/attempts/[attemptId]/videos/[videoOrder]/route.ts`
- Create: `app/api/local/attempts/[attemptId]/videos/[videoOrder]/route.test.ts`

**Interfaces:**
- Consumes: `CurrentVideoAuthorizationRepository`; Phase 1 tests use a local in-memory fixture, and Phase 2 replaces it with SQLite.
- Produces: current-order URL `/api/local/attempts/{attemptId}/videos/{videoOrder}`.

- [ ] **Step 1: Test authorization before file access**

Require server mode `local`, an in-progress local attempt, and exact first-unanswered order. Knowing a filename/video ID is insufficient. Reject previous/future/completed/unknown attempts before opening a file.

- [ ] **Step 2: Implement `GET` and `HEAD` streaming**

Use Node runtime and disk streaming. No Range returns 200; one valid range returns exact 206 bytes; invalid/multiple/unsatisfiable ranges return 416 with `Content-Range: bytes */size`; `HEAD` returns headers without a body. Include `Accept-Ranges`, `Content-Type: video/mp4`, exact `Content-Length`, and partial `Content-Range`.

- [ ] **Step 3: Prove source isolation**

Tests make all Supabase and Storage adapters throw if imported/called. Missing files return `LOCAL_VIDEO_MISSING` containing video ID but no absolute path and no remote fallback.

### Task 6: P1 gate

**Files:**
- Create: `.env.local.example`
- Modify: `next.config.mjs` only if required for route/runtime isolation.

- [ ] **Step 1: Add non-secret LOCAL configuration names**

```env
ASSESSMENT_DEPLOYMENT_MODE=local
LOCAL_DATABASE_PATH=/Users/Shared/deskilling/data/local-assessment.sqlite
LOCAL_STUDY_PACKAGE_PATH=/Users/Shared/deskilling/study-package.json
LOCAL_VIDEO_ROOT=/Users/Shared/deskilling/videos
```

- [ ] **Step 2: Run phase verification**

Run focused tests, standard gates, and a localhost Range smoke test. Confirm no migration file, Supabase write, live DB dependency, `release` change, or ECS action occurred. Stop for Phase 2 approval.

---

## Phase 2: LOCAL SQLite and Sealed Study Package

### Task 7: Pin and configure the SQLite runtime

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `next.config.mjs`

- [ ] **Step 1: Install exact dependencies**

```bash
npm install --save-exact better-sqlite3@13.0.3 canonicalize@4.0.0
npm install --save-dev --save-exact @types/better-sqlite3@9.6.0
```

- [ ] **Step 2: Keep native SQLite server-only**

Configure `serverExternalPackages: ["better-sqlite3"]`. Build tests must prove browser chunks contain no SQLite module, local absolute paths, package roster, lesion ground truth, or service-role credential names.

### Task 8: Create the durable LOCAL SQLite schema

**Files:**
- Create: `lib/local/sqlite/database.ts`
- Create: `lib/local/sqlite/schema.ts`
- Create: `lib/local/sqlite/database.test.ts`

**Interfaces:**
- Produces:

```ts
export function openLocalDatabase(databasePath: string): Database.Database;
export function migrateLocalDatabase(db: Database.Database): void;
export function assertLocalIntegrity(db: Database.Database): void;
```

- [ ] **Step 1: Test guarded open**

Block missing parent, directory path, unreadable/corrupt existing file, future schema version, failed migration, and integrity failure without truncating or replacing the existing file.

- [ ] **Step 2: Configure durability**

Enforce foreign keys, WAL, `busy_timeout = 5000`, and `synchronous = FULL`; run `quick_check` on start and `integrity_check` before FORMAL start/export.

- [ ] **Step 3: Create version 1 schema transactionally**

Create `local_assessment_attempts`, `local_assessment_queue`, `local_responses`, `local_lesion_detection_events`, `local_video_metadata_snapshot`, `local_study_packages`, `local_sync_log`, and `local_schema_migrations`. Generate `attempt_id` natively in SQLite before queue creation. Enforce attempt-scoped queue/response/event uniqueness and identity FKs. Store UTC timestamps with millisecond precision and recorded media time without binary-rounding drift.

### Task 9: Define and validate the sealed package and formal roster

**Files:**
- Create: `lib/local/studyPackage.ts`
- Create: `lib/local/studyPackage.test.ts`
- Create: `scripts/local-study/build-package.mjs`
- Create: `scripts/local-study/validate-package.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces:

```ts
export type LocalStudyPackageV1 = {
  packageVersion: 1;
  minimumSchemaVersion: 1;
  studyMode: "dev" | "formal";
  generatedAt: string;
  allowedParticipantIds: readonly string[];
  videos: readonly {
    videoId: string;
    filePath: string;
    hasLesion: boolean;
    lesionOnsetSec: number | null;
    isTest: boolean;
    sessionPool: 1 | 2 | 3 | null;
    fileSizeBytes: number;
    fileSha256: string;
  }[];
  checksumSha256: string;
};
```

- [ ] **Step 1: Make package mode authoritative**

`studyMode` comes only from the server-loaded package. No route accepts a participant-supplied mode. A DEV package selects test videos. A FORMAL package selects only non-test videos from its session pools.

- [ ] **Step 2: Add the coded participant roster**

FORMAL requires a non-empty, normalized, unique `allowedParticipantIds` array. Package creation reads an operator-controlled coded-ID roster outside Git. Reject whitespace variants, duplicates, empty IDs, and password/secret-like columns. The final package contains coded participant IDs only, never passwords, email addresses, Auth UUIDs, access codes, or password hashes.

- [ ] **Step 3: Validate FORMAL videos and metadata**

Require exactly 40 videos for each pool 1/2/3, 120 unique video IDs and file paths across pools, regular readable MP4 files, exact size/SHA-256, and complete valid lesion metadata. Reject test videos in FORMAL and any cross-pool reuse.

- [ ] **Step 4: Seal the manifest**

Sort participant IDs and videos, canonicalize all manifest fields except `checksumSha256` with RFC 8785, calculate SHA-256, then write the final package atomically outside Git. Attempt creation stores package checksum and a complete immutable metadata snapshot.

- [ ] **Step 5: Test package-source flexibility without migration dependency**

Package tooling accepts a validated P0A export or an operator-approved equivalent manifest fixture. It does not query or require `assessment_attempts`, attempt-aware RPCs, live migration history, or ECS. A real FORMAL package cannot be declared ready until video metadata, files, hashes, and roster are verified.

### Task 10: Implement the native LOCAL attempt repository

**Files:**
- Create: `lib/local/sqlite/localAssessmentRepository.ts`
- Create: `lib/local/sqlite/localAssessmentRepository.test.ts`
- Modify: `lib/assessment/assessmentRepositoryFactory.ts`

**Interfaces:**
- Implements `AssessmentRepository` and `CurrentVideoAuthorizationRepository` from Phase 1.

- [ ] **Step 1: Test roster-gated start**

For FORMAL, reject any participant ID absent from `allowedParticipantIds` before creating an attempt. For an approved ID, create a random UUID, freeze package mode/checksum, snapshot metadata, randomize the correct session pool once, and persist attempt plus complete queue in one transaction.

- [ ] **Step 2: Test resume/selection**

Resume by explicit attempt ID. If participant/session has one in-progress attempt, it may be suggested; if multiple exist, return `attempt_choice_required` and never choose by timestamp. Completed/abandoned/invalid attempts are read-only.

- [ ] **Step 3: Test response/event transaction semantics**

Preserve current marks, deletion, yes/no mutual exclusion, first-final-valid positive summary, null no-lesion detection time/latency, separate no-response latency, negative detection latency, correctness derivation from the snapshot, atomic response/events, exact duplicate retry, differing-retry rejection, current-order enforcement, and completion after one response per order.

- [ ] **Step 4: Test failures and recovery**

Simulate busy DB, read-only/disk-full, event insert failure, response insert failure, process restart, WAL reopen, and corrupt package. No failed transaction advances the queue or creates a partial trial.

### Task 11: Expose LOCAL attempt APIs backed only by SQLite

**Files:**
- Create: `app/api/local/attempts/route.ts`
- Create: `app/api/local/attempts/[attemptId]/responses/route.ts`
- Create: `app/api/local/attempts/[attemptId]/abandon/route.ts`
- Create: `app/api/assessment/start/route.ts`
- Create: `app/api/assessment/response/route.ts`
- Create: `app/api/assessment/video/route.ts`
- Modify: `lib/video/localVideoAccessGateway.ts`

- [ ] **Step 1: Validate every request server-side**

Reject unknown payload keys including all mode/pool/test/ground-truth fields. LOCAL start derives mode and roster from the sealed package, validates participant ID, and returns no ground truth or filesystem path.

- [ ] **Step 2: Replace the Phase 1 fixture authorizer with SQLite**

Every video `GET`/`HEAD` request reopens/queries SQLite, verifies attempt status and first-unanswered order, and reads only the immutable snapshot relative path. No live database call is permitted.

- [ ] **Step 3: P2 gate**

Run SQLite/package/roster/API/video tests plus standard gates. Search Phase 1-2 code for Supabase imports under LOCAL modules and for `studyMode` in browser start payloads. Stop for approval.

---

## Phase 3: Complete Fully Offline LOCAL Experiment

### Task 12: Wire the current assessment UI to the LOCAL repository

**Files:**
- Modify: `components/AssessmentClient.tsx`
- Modify: `components/AssessmentVideoPlayer.tsx`
- Modify: `components/LesionSurvey.tsx`
- Modify: `components/AssessmentFlow.test.mjs`
- Modify: `components/AssessmentVideoPlayer.test.mjs`
- Modify: `lib/lesionResponse.ts`
- Modify: `lib/lesionResponse.test.ts`

- [ ] **Step 1: Keep participant intake limited**

LOCAL participant UI shows only participant ID, Session 1/2/3, and explicit attempt selection when required. It never displays or submits study mode, password, access code, roster, package path, video path, or ground truth.

- [ ] **Step 2: Preserve player and response behavior**

Keep first-pass forward-seek restriction, backward seek within watched content, free replay after the first real `ended`, silent video, repeated lesion marks, deletion before submission, yes/no mutual exclusion, No override behavior, response timing from `performance.now()`, millisecond video time, negative detection latency, retry after failed durable write, dynamic queue length, resume, and completion lock.

- [ ] **Step 3: Keep SurveyJS as validation boundary**

Do not add Survey Creator/admin UI. The player consumes only a playback URL and attempt context; it contains no SQLite, filesystem, package, Supabase, Storage, or Auth logic.

### Task 13: Verify a complete disconnected FORMAL experiment

**Files:**
- Create: `tests/e2e/local-offline-assessment.spec.ts`
- Create: `playwright.config.ts` if not already present.

- [ ] **Step 1: Start with no Supabase configuration or network**

Unset all Supabase variables, deny outbound network for the app/browser test environment, bind Next.js to `127.0.0.1`, and load a validated FORMAL package plus local MP4 root.

- [ ] **Step 2: Test roster enforcement**

Unknown and typo participant IDs must fail without creating any SQLite attempt/queue rows. An approved coded ID must create exactly one attempt with 40 queue rows from the requested session pool.

- [ ] **Step 3: Complete all 40 videos**

Exercise positive/negative trials, multiple/deleted marks, seek/replay behavior, pause/resume, exact 206 requests, and durable progress. Verify every response/event/timing field directly from SQLite.

- [ ] **Step 4: Test restart recovery**

Restart browser and Next.js mid-session; reopen the same SQLite file; resume the same attempt at the first unanswered order; finish; restart again; show Completed immediately and reject further submission.

- [ ] **Step 5: Prove complete source isolation**

Network logs contain loopback requests only. LOCAL server logs/browser payloads contain no Supabase call, signed URL, service credential, package roster, lesion ground truth, or absolute filesystem path.

### Task 14: Declare the emergency LOCAL system operational

**Files:**
- Modify: `README.md`
- Create: `docs/local-offline-operator-runbook.md`

- [ ] **Step 1: Document operator preflight and recovery**

Cover package/roster validation, video hash check, SQLite integrity check, loopback start, participant/session entry, restart recovery, backup of SQLite plus WAL state, terminal attempt export, and clear errors for missing package/video/disk writes.

- [ ] **Step 2: Run P3 final gates**

Run focused tests, full offline Playwright flow, standard gates, and one overall LOCAL code review. Record proof that no Phase 1-3 task required a live attempt migration.

- [ ] **Step 3: Stop for explicit approval**

At this point the Mac must be a genuinely usable emergency experimental system. Do not begin Phase 4 database work until the user explicitly approves it.

---

## Phase 4: Full Live Supabase Preflight and Attempt-Aware Migration

### Task 15: Add the exhaustive live preflight tooling

**Files:**
- Create: `scripts/supabase/live-preflight.sql`
- Create: `scripts/supabase/verify-preflight-report.mjs`
- Create: `scripts/supabase/compare-live-repository.mjs`
- Create: `scripts/supabase/preflight-tools.test.mjs`

**Interfaces:**
- Produces ignored raw reports for database catalog/data integrity, deployed Edge Functions, and repository/live comparison.

- [ ] **Step 1: Inventory the actual live environment in one read-only transaction**

Inspect actual schemas/tables/columns/defaults/identity fields; constraints/indexes/predicates/sequences/triggers/extensions; RPC names, identity arguments, return types, definitions, owners, ACLs, grants, security mode, search path, language and volatility; RLS/forced-RLS/policies; schema/table/function privileges; Storage buckets and Storage policies; `assessment_runtime_config`; existence/state of `assessment_session_access`, `assessment_enrollments`, and `assessment_attempts`; exact video/queue/response/event counts; and `supabase_migrations.schema_migrations` when present.

- [ ] **Step 2: Run data-integrity audits**

Count/fingerprint duplicate queue orders/videos, duplicate responses/events, queue gaps, missing-video queue rows, orphan responses/events, queue/child identity mismatches, response completeness, null/unknown attempt IDs, and ambiguous participant/session mode mappings. Exact offending keys stay in an encrypted ignored mode-0600 artifact; committed reports contain salted hashes only.

- [ ] **Step 3: Inspect deployed Edge Functions**

After discovering current official CLI commands, list and inspect/download deployed bundles without secrets. Hash and compare their request/response shapes and RPC calls with repository source. Unknown deployed contracts are blocking.

- [ ] **Step 4: Compare live state with repository history**

Normalize/hash live function definitions and compare them with repository SQL. Classify migration/definition evidence as `matched`, `live_only`, `repository_only`, `diverged`, or `unknown`; filenames alone never prove application.

### Task 16: Publish the P4A verdict

**Files:**
- Create: `docs/superpowers/audits/2026-08-29-live-supabase-preflight.md`

- [ ] **Step 1: Write the sanitized full audit**

Include all required catalog, permissions, policies, functions, Edge Functions, counts, integrity, runtime config, access/enrollment existence, and migration-history results with raw-report hashes and `database_writes_performed: 0`.

- [ ] **Step 2: Apply blocking semantics**

Use `SAFE_TO_DESIGN_ATTEMPT_MIGRATION` only when every legacy row can be mapped losslessly and the current ECS contract is known. Otherwise use:

```text
BLOCKED_BY_ENVIRONMENT
blocks: live_supabase_migration, synchronization_deployment, online_auth_deployment
does_not_block: local_sqlite, local_study_package, local_video_streaming, offline_local_collection
database_writes_performed: 0
```

Stop all remaining Phase 4 migration tasks if blocked. Keep the completed Phase 3 LOCAL system operational.

### Task 17: Build the restored-copy migration harness

**Files:**
- Create: `supabase/fixtures/legacy-live-shape.sql`
- Create: `supabase/assessment_attempts.contract.test.mjs`

- [ ] **Step 1: Derive sanitized fixtures from P4A evidence**

Represent empty, partial, complete, DEV, FORMAL, repeated-mark, negative-latency, exact-retry, and Session 1/2/3 states with synthetic IDs.

- [ ] **Step 2: Test deterministic legacy backfill**

Use UUIDv5 namespace `c9811a35-5bb1-422b-85cf-7967240841dc` and exact name bytes `participant_id + chr(31) + session_number`. Preserve bigint IDs, timestamps, answers, timing, and events. Block ambiguous mode, duplicates, and orphans.

- [ ] **Step 3: Snapshot current release contracts**

Tests must preserve the exact live legacy RPC names/signatures/results/grants/errors and current video Edge Function request/response contract used by `d4957edd455e7f99bc71cbde09c23254edabcfac`.

### Task 18: Rehearse Stage A and Stage B compatibility migrations

**Files:**
- Create through CLI: migration named `assessment_attempts_stage_a`
- Create through CLI: migration named `legacy_attempt_api_bridge_stage_b`
- Modify: `supabase/assessment_attempts.contract.test.mjs`

- [ ] **Step 1: Generate migrations only with the official CLI**

```bash
supabase migration new assessment_attempts_stage_a
supabase migration new legacy_attempt_api_bridge_stage_b
```

- [ ] **Step 2: Stage A remains additive**

Create `assessment_attempts` and validity-decision audit, add nullable child `attempt_id`, deterministic legacy attempts, immutable/status/validity constraints, and compatible attempt-aware indexes while keeping all old uniqueness and APIs.

- [ ] **Step 3: Stage B scopes legacy APIs without changing their contracts**

Bind legacy session access to one legacy attempt. Replace function bodies only so all queue/progress/response/event/video queries are attempt-scoped. Keep names, signatures, result shapes, credentials, errors, grants, and the legacy Edge Function contract unchanged. Harden every privileged function owner/search path/grant.

- [ ] **Step 4: Rehearse on a restored live copy**

Apply twice from fresh restores, compare pre/post counts/hashes, run contract/security/advisor tests, and run the unchanged `d4957ed` browser through start, random queue, resume, signed video, positive/negative submission, event insert, retry, next order, and completion.

### Task 19: Obtain approval and apply Stage A/B, then rehearse Stage C

**Files:**
- Create through CLI after P4B approval: migration named `activate_attempt_constraints_stage_c`

- [ ] **Step 1: Stop for explicit live Stage A/B approval**

Present P4A evidence, exact SQL diff, backup/restore procedure, lock/runtime estimate, restored-copy proof, and unchanged-release smoke protocol. General implementation approval is insufficient.

- [ ] **Step 2: Re-run full preflight and take a recoverable backup**

Abort if catalog hashes, functions, Edge Functions, policies, counts, or integrity findings changed. Apply only approved Stage A/B, then read back counts/constraints/grants/RLS/advisors and run the unchanged ECS browser smoke tests with dedicated IDs.

- [ ] **Step 3: Rehearse Stage C separately**

On a fresh post-B restore, drop old participant/session uniqueness only after all child attempt IDs are valid; activate attempt-scoped uniqueness/composite FKs/`NOT NULL`; prove multiple attempts for one participant/session work and within-attempt duplicates/mismatches fail.

- [ ] **Step 4: Stop for separate Stage C approval**

Repeat backup, preflight, controlled apply, post-check, and unchanged-release browser verification only after approval naming Stage C. Keep legacy access-code APIs and legacy Edge Function for rollback.

- [ ] **Step 5: P4C gate**

Only a verified P4C state permits synchronization or ONLINE Auth deployment. LOCAL remains independently operational regardless of P4 outcome.

---

## Phase 5: LOCAL-to-Supabase Synchronization

### Task 20: Build canonical immutable local payloads

**Files:**
- Create: `lib/sync/canonicalPayload.ts`
- Create: `lib/sync/canonicalPayload.test.ts`
- Create: `lib/sync/localAttemptExporter.ts`

- [ ] **Step 1: Define canonical payload version 1**

Include attempt metadata, ordered queue, ordered responses, ordered events, original UUID/timestamps, package checksum/manifest, and schema version. Encode timestamps as UTC ISO-8601 with exactly three fractional digits; media seconds as three-decimal strings; durations/latencies as integers.

- [ ] **Step 2: Hash deterministically**

Sort by natural keys, serialize with RFC 8785, calculate SHA-256, and freeze the digest locally before upload. Reject in-progress attempts, integrity failures, duplicate keys, package mismatch, and any payload mutation after digest creation.

### Task 21: Rehearse the atomic sync and validity migration

**Files:**
- Create through CLI: migration named `local_attempt_sync_rpc`
- Create: `supabase/local_attempt_sync.contract.test.mjs`

- [ ] **Step 1: Create service-role-only private functions**

`private.sync_local_assessment_attempt(jsonb,text)` validates schema/package/digest, locks attempt and participant/session, verifies queue/video/timing/event semantics, and inserts attempt/queue/responses/events in one transaction. `private.set_assessment_attempt_validity(uuid,boolean,text)` performs explicit locked/audited validity changes.

- [ ] **Step 2: Test conflicts and replacement attempts**

Cover: no prior attempt; incomplete ONLINE attempt plus replacement LOCAL attempt; existing completed valid attempt; identical same-ID retry; differing same-ID payload. Never merge attempts, move child rows, clear validity silently, or leave partial inserts.

- [ ] **Step 3: Security and restored-copy gate**

Revoke `PUBLIC`, `anon`, and `authenticated`; grant only service role; use trusted owner, empty search path, schema-qualified objects, advisors, and restored-copy rollback tests. Deployment requires separate approval plus fresh P4 preflight/backup.

### Task 22: Add explicit operator synchronization

**Files:**
- Create: `lib/sync/syncClient.ts`
- Create: `lib/sync/syncClient.test.ts`
- Create: `scripts/local-study/sync-terminal-attempt.mjs`
- Modify: `package.json`

- [ ] **Step 1: Keep sync outside participant flow**

Expose only an explicit operator command for terminal `completed`, `abandoned`, or `invalid` attempts. Missing credentials disable sync only; LOCAL collection remains usable. Never sync automatically or from page load.

- [ ] **Step 2: Implement idempotent state transitions**

Use `never_synced|sync_failed|conflict -> syncing -> synced|sync_failed|conflict`. Set `synced_at` only after atomic acceptance or explicit conflict resolution. Preserve original attempt ID, queue order, timestamps, marks, and timing.

- [ ] **Step 3: Verify field-for-field readback**

Run synthetic Cases A-E, network-loss-before/after-acceptance, retry, differing-payload, and child-failure tests. Compare every imported natural key/value with SQLite and prove analysis never combines attempts.

- [ ] **Step 4: P5 gate**

Run focused/standard tests and review. Stop for ONLINE Auth approval.

---

## Phase 6: ONLINE Account Pool and Supabase Auth

### Task 23: Create account mapping and roster-matched provisioning

**Files:**
- Create through CLI: migration named `online_participant_auth`
- Create: `scripts/online/provision-participant-accounts.mjs`
- Create: `scripts/online/provision-participant-accounts.test.mjs`
- Create: `supabase/online_auth.contract.test.mjs`

- [ ] **Step 1: Create private account/rate-limit tables**

Map one Auth UUID to one coded participant ID and internal email in a non-exposed private schema. Store no plaintext password, password hash, or access code in public study tables. Add tightly scoped login rate-limit state.

- [ ] **Step 2: Require exact roster equality**

Provisioning reads the approved FORMAL package roster and refuses extra, missing, duplicate, or differently normalized IDs. Thus LOCAL roster and ONLINE account pool use the same coded participant IDs. The package remains password-free.

- [ ] **Step 3: Provision idempotently**

Generate one 12-character unambiguous random password per participant, reused for Sessions 1-3. Create/pre-confirm Auth user, insert mapping, compensate on partial failure, and write credentials once to an operator-selected mode-0600 file outside Git. Stdout shows counts only.

### Task 24: Add participant-ID/password sign-in

**Files:**
- Create: `supabase/functions/participant-sign-in/index.ts`
- Create: `supabase/functions/participant-sign-in/deno.json`
- Create: `supabase/functions/participant-sign-in/index.test.ts`

- [ ] **Step 1: Keep authentication separate from assessment start**

`OnlineAuthCredentials` contains participant ID and password. After login, assessment start contains session and optional attempt selection; the server derives participant identity and study mode. Neither Auth nor start accepts participant-controlled study mode.

- [ ] **Step 2: Implement generic errors and rate limiting**

Resolve private internal email in trusted context, use normal Supabase password sign-in, return a session or one generic invalid-credential response, and never log password/internal email/service key. Unknown, inactive, wrong-password, and throttled cases do not reveal account existence.

### Task 25: Add authenticated attempt RPCs and private-video v2 function

**Files:**
- Create through CLI: migration named `online_attempt_rpc_v2`
- Create: `supabase/functions/issue-assessment-video-url-v2/index.ts`
- Create: `supabase/functions/issue-assessment-video-url-v2/deno.json`
- Create: `lib/supabase/browserClient.ts`
- Create: `lib/online/onlineAssessmentRepository.ts`
- Create: `lib/online/remoteVideoAccessGateway.ts`

- [ ] **Step 1: Bind attempts to `auth.uid()`**

Start/resume/submit RPCs derive active participant from private mapping and study mode from database configuration. Accept session/attempt/trial data, never trusted participant ID or mode. Enforce ownership, runtime channel, status, session, current order, and duplicate semantics.

- [ ] **Step 2: Authorize one private current video**

The v2 Edge Function requires a valid user JWT and accepts attempt ID plus video order only. It verifies mapped ownership/current order, obtains bucket/path internally, and returns one temporary signed URL. Anonymous direct Storage access and LOCAL fallback remain forbidden.

- [ ] **Step 3: Rehearse before deployment**

Run RLS/grant/advisor/JWT/ownership/private-video/three-session tests on the approved test/restored environment. Live migration/functions require separate approval and fresh P4 verification.

### Task 26: Update ONLINE UI and complete Auth verification

**Files:**
- Modify: `components/AssessmentClient.tsx`
- Modify: `components/AssessmentFlow.test.mjs`
- Create: `components/OnlineAuthentication.test.mjs`
- Modify: `.env.production.example`

- [ ] **Step 1: Keep mode-specific inputs correct**

LOCAL shows participant ID/session/attempt choice only. ONLINE authentication shows participant ID/password; assessment choice shows Session 1/2/3 and attempt choice. Neither flow shows or sends Study access code or study mode.

- [ ] **Step 2: Verify ONLINE isolation and ownership**

Test valid/invalid login, participant-ID editing, inactive user, Sessions 1-3, attempt resume/choice, private video, marks, yes/no, retry, completion, logout, and expired session. ONLINE must never open SQLite or local routes.

- [ ] **Step 3: P6 gate**

Run focused/standard tests, advisors, real-browser smoke, and one overall review. Keep legacy access APIs for rollback. Stop for release approval.

---

## Phase 7: Explicit Manual Release Promotion

### Task 27: Promote only explicitly approved commits

**Files:**
- Modify only after approval: `docs/environment-and-release-workflow.md`
- Modify only after approval: `docs/alibaba-ecs-deployment.md`
- Do not add CI/CD, webhook, scheduled deployment, automatic sync, or automatic promotion files.

- [ ] **Step 1: Record branch and ECS state**

Record local/origin `main`, local/origin `release`, and current ECS SHA. The expected unchanged baseline is `d4957edd455e7f99bc71cbde09c23254edabcfac` unless a separately documented approved deployment changed it.

- [ ] **Step 2: Present exact promotion commits**

Fast-forward only if every intervening commit is approved; otherwise cherry-pick only named approved commits. Do not merge unrelated `main` work. Obtain explicit approval before changing `release`.

- [ ] **Step 3: Validate and deploy manually**

On `release`, run `npm ci`, typecheck, tests, build, and secret/path/package/SQLite/video leak scans. On ECS, record prior SHA, fetch/switch/pull `origin/release --ff-only`, repeat gates, restart PM2, and run HTTP/Auth/attempt/queue/signed-video/response/resume/completion/analysis smoke tests.

- [ ] **Step 4: Roll back on failure**

Checkout the recorded known-good release commit/tag, run `npm ci`, build, restart PM2, and repeat verification. Never roll back by switching ECS to `main`.

- [ ] **Step 5: Delay legacy access cleanup**

Do not remove old access-code RPCs, legacy Edge Function, `assessment_session_access`, or `assessment_enrollments` in this release. After a separately approved rollback window, generate a dedicated Stage D cleanup migration, rehearse, back up, obtain approval, and preserve every attempt/queue/response/event row.

---

## Final Self-Review and Verification Matrix

- [ ] Dependency graph shows no Phase 1-3 task consumes a new live Supabase table, migration, RPC, Auth user, or Edge Function.
- [ ] Phase 0A uncertainty does not block LOCAL implementation; it blocks only real package readiness where metadata are missing and all Phase 4-6 live deployment work.
- [ ] `ParticipantStartInput` contains only participant ID, Session 1/2/3, and optional attempt ID.
- [ ] No participant/browser payload accepts `studyMode` or `study_mode`.
- [ ] LOCAL mode is selected only by the sealed server-loaded package; ONLINE mode is selected only by trusted database/server configuration.
- [ ] FORMAL LOCAL package contains a normalized approved coded-ID roster and no passwords, emails, Auth UUIDs, hashes, or access codes.
- [ ] FORMAL LOCAL start rejects unknown/typo participant IDs before any attempt/queue write.
- [ ] ONLINE account provisioning requires exact equality with the FORMAL package roster.
- [ ] LOCAL path/Range/current-order route passes 200/206/416/HEAD, traversal, symlink, missing-file, and future-order tests.
- [ ] LOCAL SQLite owns attempt IDs, queue, responses, events, progress, completion, and recovery before any live attempt migration.
- [ ] A new approved participant completes all 40 FORMAL videos with network disabled and resumes after browser/Next.js restart.
- [ ] LOCAL collection makes no Supabase/Storage requests; ONLINE makes no SQLite/local-file requests.
- [ ] P4 full preflight identifies actual tables/columns, constraints/indexes, RPC signatures, owners/grants, RLS/policies, Storage policies, Edge Functions, config/access/enrollment state, row counts, integrity, and applied/diverged migration evidence.
- [ ] `BLOCKED_BY_ENVIRONMENT` blocks live migration, sync deployment, and Auth deployment but leaves the Phase 3 LOCAL system usable.
- [ ] No live migration occurs without fresh preflight, backup, restored-copy rehearsal, unchanged-release compatibility proof, and separate approval.
- [ ] Sync is terminal-only, atomic, idempotent, conflict-preserving, replacement-aware, and field-for-field verified.
- [ ] ONLINE Auth binds participant ownership to `auth.uid()` and keeps private Storage private.
- [ ] `release` and ECS remain unchanged until Phase 7 receives explicit promotion approval.
- [ ] Each phase runs focused tests, `npm run typecheck`, `npm test`, `npm run build`, and its review checkpoint.
