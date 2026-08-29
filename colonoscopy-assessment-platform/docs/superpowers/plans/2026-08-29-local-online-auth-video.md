# Local and Online Authentication, Attempts, and Video Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add attempt-scoped study execution, fully offline LOCAL collection and local video streaming, explicit LOCAL-to-Supabase synchronization, and participant-password ONLINE authentication while preserving the currently deployed ECS release until a separately approved manual promotion.

**Architecture:** Shared assessment components depend on `AssessmentRepository` and `VideoAccessGateway`; server-only deployment mode selects either SQLite/local-file implementations or authenticated Supabase/private-Storage implementations. Supabase changes are staged behind a compatibility bridge, and every live database stage is preceded by a read-only inventory, restored-copy rehearsal, explicit approval, and unchanged-release smoke test.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 5.8, SurveyJS Form Library 2.5, Supabase PostgreSQL/Auth/Storage/Edge Functions, PostgreSQL, Node.js 22, `better-sqlite3@13.0.3`, `@types/better-sqlite3@9.6.0`, `canonicalize@4.0.0`, Node test runner, Playwright for real-browser verification.

**Spec:** `docs/superpowers/specs/2026-08-29-local-online-auth-video-design.md`

## Global Constraints

- Treat the live Supabase schema as unknown until Phase 0 finishes from live, read-only evidence.
- Do not infer live tables, functions, policies, Edge Functions, or applied migrations from repository SQL.
- If Phase 0 cannot map every legacy row and current API contract safely, record `BLOCKED_BY_ENVIRONMENT` and stop before creating or applying migration SQL.
- Never delete or silently rewrite existing `videos`, `assessment_queue`, `responses`, or `lesion_detection_events` research/test rows.
- `main` is the only implementation branch; `release` and the running ECS remain unchanged through Phases 0-5.
- Use inline `superpowers:executing-plans` execution with the checkpoints below; do not dispatch new subagents or per-task reviewer agents.
- Do not execute two large phases in one approval window. Finish focused tests, standard gates, review, and explicit approval before starting the next phase.
- Every live Supabase migration stage requires a fresh backup, restored-copy rehearsal, security review, explicit user approval, post-write verification, and unchanged `d4957edd455e7f99bc71cbde09c23254edabcfac` browser smoke test.
- `ASSESSMENT_DEPLOYMENT_MODE` is server-only and must be exactly `local` or `online`; missing or invalid values fail closed.
- LOCAL binds only to `127.0.0.1`, never falls back to Supabase Storage, and never exposes absolute paths, SQLite access, ground truth, or service-role credentials to the browser. The transitional Phase 2 slice may use Supabase database persistence; final Phase 3 LOCAL collection must not call any Supabase service.
- ONLINE uses Supabase Auth identity and private Supabase Storage only; it never reads LOCAL files or SQLite.
- The same attempt never crosses runtime channels. Replacement attempts start at Video 1 and remain distinct.
- Use exact path staging for commits because the repository already contains unrelated uncommitted work.
- Run `npm run typecheck`, `npm test`, and `npm run build` at every phase gate.

## Phase Gates

| Gate | Required evidence | Stop condition |
| --- | --- | --- |
| P0 | Sanitized live inventory, raw local audit bundle, integrity results, migration-history comparison | Any inaccessible catalog, unknown RPC/owner/grant, ambiguous row mapping, or repository/live divergence without explanation produces `BLOCKED_BY_ENVIRONMENT` |
| P1A | Stage A/B migration passes against a restored live copy; legacy contract tests and unchanged-release browser flow pass | No live migration without a separate explicit approval |
| P1B | Stage A/B live post-checks and unchanged-release smoke tests pass | Stage C remains prohibited until another explicit approval |
| P1C | Attempt-scoped constraints pass rehearsal and approved live window | Do not remove legacy access APIs |
| P2 | Connected LOCAL vertical slice passes local Range/player tests with dedicated test IDs | Do not treat this transitional Supabase-backed slice as offline-ready |
| P3 | Full LOCAL attempt completes and resumes with network disabled | Do not add synchronization until SQLite integrity/export is accepted |
| P4 | Sync Cases A-E, rollback, idempotency, and validity auditing pass | Do not expose ONLINE Auth until sync migration is separately approved |
| P5 | ONLINE Auth, ownership, private video, and complete study flow pass | Do not modify `release` or ECS |
| P6 | Explicit promotion approval and recorded known-good SHA | No automatic deployment and no delayed access-code cleanup in the same release |

## Planned File Map

### Phase 0 and migration proof

- Create `scripts/supabase/live-preflight.sql`: one read-only PostgreSQL catalog/data audit.
- Create `scripts/supabase/verify-preflight-report.mjs`: require every inventory section and calculate report hashes.
- Create `scripts/supabase/compare-live-repository.mjs`: compare live migration/function fingerprints with repository SQL without asserting equivalence from filenames.
- Create `scripts/supabase/preflight-tools.test.mjs`: sanitized parser, completeness, and secret-leak fixtures.
- Modify `.gitignore`: exclude raw `artifacts/supabase-preflight/` and database dumps.
- Create `docs/superpowers/audits/2026-08-29-live-supabase-preflight.md`: sanitized conclusions and the P0 verdict only.
- Create migration files only through `supabase migration new`: Stage A attempts, Stage B legacy bridge, Stage C attempt constraints, Phase 4 sync, Phase 5 Auth, and delayed Stage D cleanup.
- Create `supabase/assessment_attempts.contract.test.mjs`: migration and compatibility assertions.
- Create `supabase/fixtures/legacy-live-shape.sql`: sanitized schema/data fixture derived from live preflight.

### Shared runtime boundaries

- Create `lib/runtime/deploymentMode.ts`: server-only environment parser.
- Create `lib/runtime/deploymentMode.test.ts`: fail-closed mode tests.
- Create `lib/assessment/contracts.ts`: canonical attempt, queue, submission, repository, and error contracts.
- Create `lib/assessment/assessmentRepositoryFactory.ts`: server-side repository selection.
- Create `lib/video/contracts.ts`: playback source and gateway contracts.
- Create `lib/video/videoAccessGatewayFactory.ts`: server-side gateway selection.
- Modify `lib/assessmentTypes.ts`, `lib/lesionResponse.ts`, `lib/sessionConfig.ts`: add attempt identity without changing timing/classification semantics.
- Modify `components/AssessmentClient.tsx`, `components/AssessmentVideoPlayer.tsx`, `components/LesionSurvey.tsx`: consume source-neutral contracts while preserving SurveyJS and player behavior.

### LOCAL connected and video delivery

- Create `lib/video/rangeRequest.ts` and `lib/video/rangeRequest.test.ts`: strict single-range parser.
- Create `lib/video/localPath.ts` and `lib/video/localPath.test.ts`: root containment and realpath/symlink enforcement.
- Create `lib/video/localVideoAccessGateway.ts`: current-order authorization and route URL generation.
- Create `app/api/local/attempts/[attemptId]/videos/[videoOrder]/route.ts`: LOCAL-only `GET`/`HEAD` disk streaming.
- Create `app/api/assessment/start/route.ts`, `app/api/assessment/response/route.ts`, and `app/api/assessment/video/route.ts`: source-neutral browser API boundary.

### LOCAL SQLite and study package

- Modify `package.json`, `package-lock.json`, and `next.config.mjs`: pin SQLite/canonicalization dependencies and externalize the native module.
- Create `lib/local/sqlite/database.ts`: guarded database open and pragmas.
- Create `lib/local/sqlite/schema.ts`: versioned local schema and migrations.
- Create `lib/local/sqlite/localAssessmentRepository.ts`: transactional attempt/queue/response lifecycle.
- Create `lib/local/sqlite/localAssessmentRepository.test.ts`: lifecycle, atomicity, retry, and recovery tests.
- Create `lib/local/studyPackage.ts` and `lib/local/studyPackage.test.ts`: immutable manifest validation and metadata snapshot.
- Create `scripts/local/export-study-package.mjs`: connected operator export.
- Create `scripts/local/validate-study-package.mjs`: offline formal readiness command.
- Create `app/api/local/attempts/route.ts`: list/create/resume LOCAL attempts.
- Create `app/api/local/attempts/[attemptId]/responses/route.ts`: atomic local response/event submission.
- Create `app/api/local/attempts/[attemptId]/abandon/route.ts`: explicit terminal transition.

### Synchronization

- Create `lib/sync/canonicalPayload.ts` and `lib/sync/canonicalPayload.test.ts`: RFC 8785 payload and SHA-256.
- Create `lib/sync/localAttemptExporter.ts`: immutable terminal-attempt export.
- Create `lib/sync/syncClient.ts` and `lib/sync/syncClient.test.ts`: service-role-only RPC client and deterministic result handling.
- Create `scripts/local/sync-terminal-attempt.mjs`: explicit operator sync command.
- Create `supabase/local_attempt_sync.contract.test.mjs`: atomic import and Cases A-E.

### ONLINE Auth

- Create `lib/supabase/browserClient.ts`: persisted browser Auth client using only publishable configuration.
- Create `lib/online/onlineAssessmentRepository.ts`: authenticated v2 RPC adapter.
- Create `lib/online/remoteVideoAccessGateway.ts`: authenticated v2 Edge Function adapter.
- Create `supabase/functions/participant-sign-in/index.ts`: participant ID/password sign-in adapter with generic errors and rate limiting.
- Create `supabase/functions/issue-assessment-video-url-v2/index.ts`: JWT-bound attempt/order authorization and signed URL.
- Create `scripts/online/provision-participant-accounts.mjs`: idempotent coordinator provisioning and protected credential export.
- Modify `components/AssessmentClient.tsx`: ONLINE participant ID/password/session intake and LOCAL participant ID/session intake.
- Create `components/OnlineAuthentication.test.mjs`: UI and source-contract tests.

### Documentation and release

- Modify `.env.production.example`, `README.md`, `docs/environment-and-release-workflow.md`, and `docs/alibaba-ecs-deployment.md` only when the matching implementation phase is complete.
- Create `.env.local.example`: non-secret LOCAL path/mode template.
- Keep the real `.env.local`, `.env.production.local`, SQLite files, study packages, credentials, dumps, and videos outside Git.

---

## Phase 0: Read-Only Live Supabase Preflight

Phase 0 is complete only when live evidence identifies all of these items explicitly: actual tables and columns; actual constraints and indexes; actual RPC names and signatures; function owners and grants; RLS state and policies; Storage policies; deployed Edge Functions; `assessment_runtime_config` rows; whether `assessment_session_access` exists; whether `assessment_enrollments` exists; current video/queue/response/event row counts; duplicate, orphan, queue-gap, and identity-integrity findings; and which repository migrations or SQL definitions are proven applied, diverged, absent, or unknown. The report must state `database_writes_performed: 0`.

### Task 1: Add the read-only inventory tooling

**Files:**
- Create: `scripts/supabase/live-preflight.sql`
- Create: `scripts/supabase/verify-preflight-report.mjs`
- Create: `scripts/supabase/compare-live-repository.mjs`
- Test: `scripts/supabase/preflight-tools.test.mjs`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: a live PostgreSQL read channel provided by authenticated Supabase MCP `execute_sql` or a direct `psql` connection supplied by the operator.
- Produces: `artifacts/supabase-preflight/live-catalog.ndjson`, `live-edge-functions.json`, `repository-comparison.json`, and a validation exit code.

- [ ] **Step 1: Protect raw audit output from Git**

Add these exact ignore entries:

```gitignore
artifacts/supabase-preflight/
*.supabase-preflight.dump
```

- [ ] **Step 2: Write the catalog audit as one read-only transaction**

Start `live-preflight.sql` with:

```sql
begin transaction read only;
set local statement_timeout = '60s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '60s';
```

Emit labeled JSON rows for all of the following, using `pg_catalog` and `information_schema`: server/database identity without secrets; schemas; tables; columns and defaults; identity/generated columns; primary, unique, foreign-key, check, and exclusion constraints; indexes and predicates; sequences; triggers; extensions; function names, identity arguments, return types, language, volatility, `prosecdef`, owner, ACL, and configuration; table RLS/forced-RLS state; `pg_policies`; table/schema/function grants; `storage.buckets`; and policies/grants on `storage.objects` and `storage.buckets`. End with `rollback;`.

Use these catalog expressions for function identity and definitions:

```sql
pg_catalog.pg_get_function_identity_arguments(p.oid),
pg_catalog.pg_get_function_result(p.oid),
pg_catalog.pg_get_functiondef(p.oid),
pg_catalog.pg_get_userbyid(p.proowner)
```

Do not emit secrets, JWTs, signed URLs, access-code digests, participant IDs, response values, or raw clinical ground truth.

If an integrity count is non-zero and exact natural keys are required for investigator adjudication, run a second read-only query into an encrypted, mode-`0600` file under `artifacts/supabase-preflight/`. Keep that file outside Git, include no response values or ground truth, and reference only salted SHA-256 fingerprints in the sanitized audit.

- [ ] **Step 3: Add exact live-state queries**

The SQL must report existence and sanitized content for:

```text
public.assessment_runtime_config
public.assessment_session_access
public.assessment_enrollments
public.assessment_attempts
public.videos
public.assessment_queue
public.responses
public.lesion_detection_events
supabase_migrations.schema_migrations
```

For `assessment_runtime_config`, return `id` and `study_mode`. For access/enrollment tables, return only existence, columns, constraints, row counts, and grouped status/mode counts. For study data, return exact row counts only.

- [ ] **Step 4: Add integrity queries that return counts plus salted row fingerprints**

Audit duplicate queue order, duplicate queue video, duplicate response trial/order, duplicate event click index, queue gaps, queue rows missing videos, responses missing queue rows, events missing responses, events missing queue rows, participant/session/video/order mismatches, responses beyond the first unanswered order, completed sessions with missing responses, and child rows with null or unknown attempt IDs. Fingerprint offending natural keys with a run-only salt and SHA-256; do not write raw identifiers to committed reports.

- [ ] **Step 5: Verify report completeness in Node**

`verify-preflight-report.mjs` must fail non-zero unless every required section occurs exactly once, the SQL transaction reports read-only mode, `rollback` completes, all commands are `SELECT`/catalog inspection, and the output contains no obvious key/access-code/signed-URL patterns.

Run:

```bash
node scripts/supabase/verify-preflight-report.mjs artifacts/supabase-preflight/live-catalog.ndjson
```

Expected before collecting live output: FAIL with `PRECHECK_REPORT_MISSING`.

- [ ] **Step 6: Add repository/live comparison without claiming application state**

`compare-live-repository.mjs` must hash normalized live function definitions and compare them with definitions extracted from `supabase/*.sql`; compare `supabase_migrations.schema_migrations` versions with actual repository migration files; and classify each item as `matched`, `live_only`, `repository_only`, `diverged`, or `unknown`. A filename match alone must never yield `matched`.

- [ ] **Step 7: Run local script tests**

```bash
node --test scripts/supabase/*.test.mjs
npm run typecheck
```

Expected: parser fixtures pass; no live connection is required.

- [ ] **Step 8: Commit only Phase 0 tooling**

```bash
git add .gitignore scripts/supabase/live-preflight.sql scripts/supabase/verify-preflight-report.mjs scripts/supabase/compare-live-repository.mjs scripts/supabase/preflight-tools.test.mjs
git commit -m "chore: add read-only Supabase preflight tooling"
```

### Task 2: Collect the live database and platform inventory

**Files:**
- Create outside Git: `artifacts/supabase-preflight/live-catalog.ndjson`
- Create outside Git: `artifacts/supabase-preflight/live-edge-functions.json`
- Create outside Git: `artifacts/supabase-preflight/repository-comparison.json`

**Interfaces:**
- Consumes: Task 1 tooling and one authenticated read-only live access path.
- Produces: complete P0 evidence or the terminal verdict `BLOCKED_BY_ENVIRONMENT`.

- [ ] **Step 1: Discover tools rather than guessing commands**

```bash
supabase --version
supabase --help
supabase functions --help
psql --version
```

The current workstation snapshot has none of these binaries. At execution time, use authenticated Supabase MCP if it exposes read-only SQL and function listing; otherwise install the official CLI and PostgreSQL client after approval. If neither MCP nor a direct database URL can inspect `pg_catalog`, stop with `BLOCKED_BY_ENVIRONMENT: NO_READ_ONLY_CATALOG_CHANNEL`.

- [ ] **Step 2: Review current Supabase changes before using the platform**

Fetch `https://supabase.com/changelog.md`, scan relevant Auth, Edge Functions, Storage, CLI, and database breaking changes, then open the current official docs for the exact commands used. Record URLs and access date in the raw report.

- [ ] **Step 3: Execute the database audit in read-only mode**

For `psql`, require the operator-provided connection variable and stop on any error:

```bash
psql "$SUPABASE_DB_URL" --no-psqlrc --set ON_ERROR_STOP=1 --file scripts/supabase/live-preflight.sql > artifacts/supabase-preflight/live-catalog.ndjson
```

For MCP, submit the same SQL without removing `BEGIN TRANSACTION READ ONLY` or `ROLLBACK`, then save the returned text locally. Do not use a browser publishable key for catalog inspection.

- [ ] **Step 4: Inventory deployed Edge Functions from the live project**

Authenticate the official CLI to the exact project ref, list deployed functions, and record only name, status, version/import-map metadata, created/updated time, and JWT-verification setting. After checking current `supabase functions --help`, use the supported read-only download/inspection command to save each deployed bundle under the ignored raw artifact directory, hash it, and compare its request shape/RPC calls with repository source. Do not download or log deployed secrets. Required names to classify include the observed legacy `issue-assessment-video-url` plus any live-only functions. If the deployed bundle/contract cannot be inspected sufficiently to prove compatibility, stop with `BLOCKED_BY_ENVIRONMENT: EDGE_FUNCTION_CONTRACT_UNKNOWN`.

- [ ] **Step 5: Verify the three reports**

```bash
node scripts/supabase/verify-preflight-report.mjs artifacts/supabase-preflight/live-catalog.ndjson
node scripts/supabase/compare-live-repository.mjs \
  artifacts/supabase-preflight/live-catalog.ndjson \
  artifacts/supabase-preflight/repository-comparison.json
```

Expected: both commands exit 0. Any missing owner, ACL, RLS/policy, Storage policy, Edge Function, migration-history, or integrity section is a blocking failure.

### Task 3: Publish the sanitized P0 verdict and stop for review

**Files:**
- Create: `docs/superpowers/audits/2026-08-29-live-supabase-preflight.md`

**Interfaces:**
- Consumes: Task 2 validated raw reports.
- Produces: `SAFE_TO_DESIGN_ATTEMPT_MIGRATION` or `BLOCKED_BY_ENVIRONMENT`.

- [ ] **Step 1: Write the sanitized audit**

Include exact live table/column, constraint/index, RPC signature, owner/grant, RLS/policy, Storage-policy, Edge Function, runtime-config, access/enrollment-table existence, row-count, integrity-count, and migration-history findings. Include SHA-256 hashes of raw reports and classify the live state as `access_code`, `no_access_code_experimental`, `mixed`, or `unclassifiable`.

- [ ] **Step 2: Apply the migration-mapping decision rule**

The verdict is `SAFE_TO_DESIGN_ATTEMPT_MIGRATION` only when every historical participant/session group has one lossless mode classification, no duplicate/orphan prevents backfill, every current release RPC and Edge Function contract is known, and repository/live divergence is explained. Otherwise use:

```text
BLOCKED_BY_ENVIRONMENT
blocking_evidence: catalog.function_owner_missing, integrity.orphan_response_count_nonzero
required_external_change: provide function-owner catalog access and investigator adjudication for the fingerprinted orphan rows
database_writes_performed: 0
```

- [ ] **Step 3: Self-review and commit the audit only**

```bash
git add docs/superpowers/audits/2026-08-29-live-supabase-preflight.md
git diff --cached --check
git commit -m "docs: record live Supabase preflight"
```

- [ ] **Step 4: P0 review checkpoint**

Stop. If blocked, no migration file may be created. If safe, obtain explicit approval to begin Phase 1 migration design and restored-copy testing. This approval does not authorize a live migration.

---

## Phase 1: Attempt Model and Backward-Compatible Migration

### Task 4: Build a restored-copy migration contract harness

**Files:**
- Create: `supabase/fixtures/legacy-live-shape.sql`
- Create: `supabase/assessment_attempts.contract.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: sanitized P0 schema shape and raw report hashes.
- Produces: repeatable legacy fixtures and executable migration assertions.

- [ ] **Step 1: Create a sanitized fixture from live structure**

Model every live column/default/constraint/function signature needed by `d4957ed`, plus representative rows for: empty session, partial session, complete session, DEV, FORMAL, negative latency, repeated lesion marks, exact duplicate retry, and separate Sessions 1-3. Use synthetic IDs only.

- [ ] **Step 2: Write failing attempt migration tests**

Assert stable UUIDv5 backfill using namespace `c9811a35-5bb1-422b-85cf-7967240841dc` and name bytes `participant_id + chr(31) + session_number`; exact preservation of bigint IDs, timestamps, answers, timing, and events; mode derivation; attempt status; no auto-validity; rerun idempotency; and fail-fast behavior for ambiguous/orphan fixtures.

- [ ] **Step 3: Write legacy API contract snapshots**

Capture exact live names, identity arguments, result columns, grants, error categories, and Edge Function request/response body used by `d4957ed`. Tests must fail if Stage B renames a function, changes an argument list, changes a result shape, or grants broader access.

- [ ] **Step 4: Run the harness against an isolated PostgreSQL database**

Use a restored live schema/data copy in a non-production project or local PostgreSQL. Never point fixture tests at live Supabase.

```bash
node --test supabase/assessment_attempts.contract.test.mjs
```

Expected before migration files exist: FAIL with missing `assessment_attempts` and missing `attempt_id`.

### Task 5: Implement and rehearse Stage A additive migration

**Files:**
- Create through CLI: migration named `assessment_attempts_stage_a`
- Modify: `supabase/assessment_attempts.contract.test.mjs`

**Interfaces:**
- Produces: additive attempt tables/columns, deterministic backfill, validation functions, and no legacy contract change.

- [ ] **Step 1: Generate the migration through the official CLI**

```bash
supabase migration new assessment_attempts_stage_a
```

Record the generated path in the phase ledger; do not invent a timestamped filename.

- [ ] **Step 2: Add attempt and validity-audit tables additively**

Create `public.assessment_attempts` and `public.assessment_attempt_validity_decisions` with the exact spec fields, immutable-field trigger, status-transition checks, same-identity replacement FK, composite unique identity, completed-only validity check, and partial unique valid-attempt index. Enable RLS and revoke default `PUBLIC` privileges before adding narrowly scoped grants.

- [ ] **Step 3: Add nullable child attempt IDs and deterministic backfill**

Add nullable `attempt_id` to queue, responses, events, and the actual live legacy access binding. Preflight `uuid-ossp`; derive one legacy ONLINE attempt per participant/session with the fixed namespace, and abort on ambiguous study mode, duplicates, or orphans. Keep all old unique indexes.

- [ ] **Step 4: Add defensive validation without activating multiple attempts**

Create attempt-aware indexes that coexist with old uniqueness. Add a temporary trigger that fills a null child `attempt_id` only from one unambiguous bound legacy attempt and rejects every ambiguous write. Do not set child columns `NOT NULL`.

- [ ] **Step 5: Rehearse twice against the restored copy**

Apply Stage A, verify every count/hash, restore the pre-migration copy, and repeat. Then test migration re-entry only where the SQL is intentionally idempotent; migration-history application itself remains once-only.

- [ ] **Step 6: Run focused and standard tests**

```bash
node --test supabase/assessment_attempts.contract.test.mjs
npm run typecheck
npm test
npm run build
```

Expected: all preserved-data and legacy-signature assertions pass.

### Task 6: Implement and rehearse Stage B legacy API bridge

**Files:**
- Create through CLI: migration named `legacy_attempt_api_bridge_stage_b`
- Modify: `supabase/assessment_attempts.contract.test.mjs`
- Test unchanged source: Git worktree at commit `d4957edd455e7f99bc71cbde09c23254edabcfac`

**Interfaces:**
- Produces: unchanged legacy RPC/Edge Function contracts whose internals are scoped to the bound legacy attempt.

- [ ] **Step 1: Generate the bridge migration through the CLI**

```bash
supabase migration new legacy_attempt_api_bridge_stage_b
```

- [ ] **Step 2: Replace legacy RPC bodies only**

Keep every live function name, identity argument list, return shape, credential check, error category, and grant exactly as P0 recorded. Derive the bound `attempt_id` from the real legacy access table and add it to all queue/progress/response/event predicates. Every `SECURITY DEFINER` function uses a trusted owner, `set search_path = ''`, schema-qualified objects, explicit `REVOKE ... FROM PUBLIC`, and explicit role grants.

- [ ] **Step 3: Keep the old Edge Function request/response contract**

Do not deploy new Edge Function source in this task. Prove that its current RPC call resolves exactly one attempt-scoped current video and returns the same bucket/file path shape.

- [ ] **Step 4: Run unchanged-release browser tests against the restored database**

Build and run a separate worktree at `d4957ed` with a test environment pointing only to the restored/non-production Supabase project. Verify start, persisted random queue, refresh resume, private signed video load, positive response with events, negative response, duplicate retry, next-video authorization, and completion.

- [ ] **Step 5: Run security and regression checks**

Run current Supabase database advisors or equivalent official checks, inspect every function owner/grant/search path, prove anonymous direct table reads still fail, and prove direct private Storage reads fail.

- [ ] **Step 6: Commit Stage A/B rehearsal work with exact paths**

Stage only generated migration files, fixture, contract tests, and intentional package-script changes. Do not stage `supabase/remove_assessment_access_code.sql`.

### Task 7: P1A review and separately approved live Stage A/B window

**Files:**
- Create outside Git: encrypted schema/data backup and migration run log.
- Modify: sanitized audit with post-migration hashes only after execution.

**Interfaces:**
- Consumes: accepted Stage A/B rehearsal.
- Produces: live additive attempt model while retaining the unchanged release contract.

- [ ] **Step 1: Stop for explicit live-migration approval**

Present P0 evidence, restored-copy results, exact SQL diff, lock/runtime estimates, backup/restore procedure, rollback limits, and unchanged-release smoke protocol. Do not continue on general implementation approval; require approval naming Stage A/B live migration.

- [ ] **Step 2: Re-run P0 immediately before the window**

Abort if schema hashes, row counts, functions, Edge Functions, policies, or integrity findings changed.

- [ ] **Step 3: Back up and apply only Stage A/B**

Use the official migration mechanism selected after CLI discovery. Do not apply Stage C or any Auth/sync migration.

- [ ] **Step 4: Verify live state and unchanged ECS behavior**

Compare pre/post counts and hashes; ensure every legacy child has one attempt; check constraints/grants/RLS/advisors; then perform real HTTP, start/resume, signed-video playback, response/event insert, retry, next-video, and completion smoke tests against the unchanged ECS release using dedicated test IDs.

- [ ] **Step 5: P1B checkpoint**

Stop for review. If any verification fails, execute the rehearsed recovery path and do not proceed to Stage C.

### Task 8: Rehearse and separately approve Stage C attempt constraints

**Files:**
- Create through CLI: migration named `activate_attempt_constraints_stage_c`
- Modify: `supabase/assessment_attempts.contract.test.mjs`

**Interfaces:**
- Produces: attempt-scoped final child constraints while preserving the legacy bridge.

- [ ] **Step 1: Generate and test Stage C only on a fresh restored post-B copy**

Drop old participant/session uniqueness only after proving all child `attempt_id` values are non-null. Add composite queue identity, child identity FKs, unique `(attempt_id, video_order)`, queue unique `(attempt_id, video_id)`, event unique `(attempt_id, video_order, click_index)`, and child `attempt_id NOT NULL`.

- [ ] **Step 2: Prove multiple attempts and within-attempt protection**

Two attempts for one participant/session must accept independent queues; duplicates within either attempt must fail. Mismatched participant/session/video/order child rows must fail.

- [ ] **Step 3: Re-run unchanged-release and full standard gates**

```bash
node --test supabase/assessment_attempts.contract.test.mjs
npm run typecheck
npm test
npm run build
```

- [ ] **Step 4: Stop for a separate Stage C live approval**

Repeat preflight, backup, controlled apply, post-check, and unchanged-release browser verification only after approval naming Stage C. Keep all legacy access-code APIs and the legacy Edge Function.

---

## Phase 2: Connected LOCAL Vertical Slice with Local Videos

### Task 9: Introduce source-neutral contracts and fail-closed server mode

**Files:**
- Create: `lib/runtime/deploymentMode.ts`
- Create: `lib/runtime/deploymentMode.test.ts`
- Create: `lib/assessment/contracts.ts`
- Create: `lib/video/contracts.ts`
- Create: `lib/assessment/assessmentRepositoryFactory.ts`
- Create: `lib/video/videoAccessGatewayFactory.ts`
- Modify: `app/page.tsx`

**Interfaces:**
- Produces:

```ts
export type DeploymentMode = "local" | "online";
export type RuntimeChannel = DeploymentMode;
export type AttemptStatus = "in_progress" | "completed" | "abandoned" | "invalid";
export type StudyMode = "dev" | "formal";
export type SessionNumber = 1 | 2 | 3;
export type AttemptQueueItem = { videoId: string; videoOrder: number };
export type AttemptSummary = {
  attemptId: string;
  participantId: string;
  sessionNumber: SessionNumber;
  runtimeChannel: RuntimeChannel;
  studyMode: StudyMode;
  status: AttemptStatus;
  startedAt: string;
};
export type StartInput = {
  participantId: string;
  sessionNumber: SessionNumber;
  studyMode: StudyMode;
  attemptId?: string;
};
export type AssessmentAttemptSession = AttemptSummary & {
  queue: readonly AttemptQueueItem[];
  nextVideoOrder: number;
  isComplete: boolean;
};
export type StartResult =
  | { kind: "session"; session: AssessmentAttemptSession }
  | { kind: "attempt_choice_required"; attempts: readonly AttemptSummary[] };
export type AttemptVideoSubmission = {
  attemptId: string;
  videoId: string;
  videoOrder: number;
  finalAnswer: boolean;
  responseTimeMs: number;
  noResponseLatencyMs: number | null;
  videoCompleted: true;
  clicks: readonly {
    clickIndex: number;
    videoTimeAtClick: number;
    responseTimeMs: number;
  }[];
};
export type SubmitResult = {
  outcome: "accepted" | "idempotent";
  nextVideoOrder: number;
  isComplete: boolean;
};
export type AttemptVideoInput = { attemptId: string; videoOrder: number };
export type VideoPlaybackSource = AttemptQueueItem & {
  attemptId: string;
  url: string;
  expiresAt: string | null;
};

export interface AssessmentRepository {
  createOrResumeAttempt(input: StartInput): Promise<StartResult>;
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
  getCurrentVideo(input: AttemptVideoInput): Promise<VideoPlaybackSource>;
}
```

- [ ] **Step 1: Write mode and factory tests first**

Assert exact `local`/`online` parsing; missing, empty, mixed-case, hostname inference, browser query/header/cookie, and unknown values fail. Assert local factories never instantiate remote adapters and online factories never import/open filesystem or SQLite adapters.

- [ ] **Step 2: Implement server-only parsing**

Use `import "server-only"`; read only `process.env.ASSESSMENT_DEPLOYMENT_MODE`; return a typed mode or throw `ASSESSMENT_DEPLOYMENT_MODE_INVALID`. `app/page.tsx` passes display-safe mode to the UI, but every server route independently rechecks mode.

- [ ] **Step 3: Add attempt identity to shared types**

`StartInput` contains participant ID, session number, study mode, optional explicit attempt ID, and no access code in LOCAL. `AttemptVideoSubmission` contains immutable `attemptId`, `videoId`, `videoOrder`, final response, timing, and marks. Keep response/event field meanings unchanged.

- [ ] **Step 4: Run focused tests and commit**

```bash
node --test lib/runtime/deploymentMode.test.ts
npm run typecheck
npm test
```

### Task 10: Implement strict local path and HTTP Range primitives

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

- [ ] **Step 1: Test all required ranges**

Cover no range, `bytes=0-99`, `bytes=100-`, `bytes=-100`, final byte, malformed unit, empty values, reversed range, multiple ranges, zero-size file, start beyond size, and suffix zero. Invalid/unsatisfiable input returns a typed 416 error carrying exact size.

- [ ] **Step 2: Test path containment**

Cover empty, absolute, NUL, `.`, `..`, URL-encoded traversal after route decoding, non-MP4, directory, missing file, symlink inside root, and symlink escaping root. Resolve `realRoot` and `realTarget`; reject when `path.relative(realRoot, realTarget)` is absolute or begins with `..`.

- [ ] **Step 3: Implement and verify**

```bash
node --test lib/video/rangeRequest.test.ts lib/video/localPath.test.ts
npm run typecheck
```

### Task 11: Add the attempt-authorized LOCAL stream route

**Files:**
- Create: `lib/video/localVideoAccessGateway.ts`
- Create: `app/api/local/attempts/[attemptId]/videos/[videoOrder]/route.ts`
- Test: `app/api/local/attempts/[attemptId]/videos/[videoOrder]/route.test.ts`

**Interfaces:**
- Consumes: `CurrentVideoAuthorizationRepository`:

```ts
authorizeCurrentVideo(attemptId: string, videoOrder: number): Promise<{
  videoId: string;
  relativeFilePath: string;
}>;
```

- [ ] **Step 1: Write route tests with a temporary video root**

Assert LOCAL-only mode, in-progress LOCAL attempt, first-unanswered order, immutable snapshot path, `GET` 200, exact 206 bytes for three range forms, 416 headers, `HEAD` body omission, and stream errors that mention video ID but never absolute path.

- [ ] **Step 2: Implement the Node runtime handler**

Export `runtime = "nodejs"` and `dynamic = "force-dynamic"`. The route accepts only attempt ID and numeric order, asks `CurrentVideoAuthorizationRepository` for the current authorized relative path, resolves under `LOCAL_VIDEO_ROOT`, and streams with `createReadStream({ start, end })` converted to a Web stream. The transitional Phase 2 authorizer derives the path from the attempt-aware Supabase queue plus `videos`; the final Phase 3 authorizer reads the attempt's immutable SQLite snapshot. The route code and response contract stay unchanged. Set `Accept-Ranges`, `Content-Type`, `Content-Length`, and partial `Content-Range` exactly.

- [ ] **Step 3: Prove no Storage fallback**

Mock all Supabase/Storage adapters to throw if called and verify the LOCAL route still passes. Missing local file must return `LOCAL_VIDEO_MISSING` without invoking remote code.

### Task 12: Wire the transitional connected LOCAL slice

**Files:**
- Create: `app/api/assessment/start/route.ts`
- Create: `app/api/assessment/response/route.ts`
- Create: `app/api/assessment/video/route.ts`
- Modify: `components/AssessmentClient.tsx`
- Modify: `components/AssessmentFlow.test.mjs`
- Modify: `.env.production.example`
- Create: `.env.local.example`

**Interfaces:**
- Consumes: attempt-aware Supabase development repository plus LOCAL stream gateway.
- Produces: source-neutral client flow with local playback and temporary connected Supabase persistence.

- [ ] **Step 1: Test browser API boundaries**

LOCAL intake has participant ID/session only. ONLINE behavior remains unchanged in this phase. Assessment components call only `/api/assessment/*`; they do not inspect filesystem, Storage, or Supabase source mode. Server routes validate all payloads and mode.

- [ ] **Step 2: Adapt the client without changing study semantics**

Keep repeated marks, mark deletion, first-pass seek restriction, replay after first real ended event, mutually exclusive yes/no, response timing, negative detection latency, atomic submission, retry, resume, and completion. Add `attemptId` to every request and key current video by attempt/order.

- [ ] **Step 3: Add LOCAL configuration template**

```env
ASSESSMENT_DEPLOYMENT_MODE=local
LOCAL_DATABASE_PATH=/Users/Shared/deskilling/data/local-assessment.sqlite
LOCAL_STUDY_PACKAGE_PATH=/Users/Shared/deskilling/study-package.json
LOCAL_VIDEO_ROOT=/Users/Shared/deskilling/videos
```

Add this exact mode line before the existing public Supabase names in `.env.production.example`:

```env
ASSESSMENT_DEPLOYMENT_MODE=online
```

The connected slice may additionally use Supabase credentials only in the operator's ignored `.env.local`. It must be labeled transitional and must not be accepted as the final offline mode.

- [ ] **Step 4: Real-browser verification**

Run on `127.0.0.1`, use participant `LOCALDEV-CONNECTED-001`, verify Network panel 206 requests, forward-seek restriction before first end, backward seek, post-end replay, marks, deletion, yes/no submission, refresh resume, and no filesystem path leakage.

- [ ] **Step 5: P2 gate**

Run focused tests, `npm run typecheck`, `npm test`, and `npm run build`; perform code review; stop for approval before SQLite work.

---

## Phase 3: Fully Offline LOCAL SQLite Collection

### Task 13: Pin SQLite and canonicalization dependencies

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `next.config.mjs`

**Interfaces:**
- Produces: stable native SQLite runtime for Node 22 and RFC 8785 serialization support.

- [ ] **Step 1: Install exact versions**

```bash
npm install --save-exact better-sqlite3@13.0.3 canonicalize@4.0.0
npm install --save-dev --save-exact @types/better-sqlite3@9.6.0
```

- [ ] **Step 2: Keep the native module server-only**

Add `serverExternalPackages: ["better-sqlite3"]` to `next.config.mjs`. Add a build test proving no browser bundle references `better-sqlite3`, local paths, or `SUPABASE_SERVICE_ROLE_KEY`.

- [ ] **Step 3: Verify install and build**

```bash
npm ci
npm run typecheck
npm test
npm run build
```

### Task 14: Implement guarded SQLite open and versioned schema

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

- [ ] **Step 1: Test safe database opening**

Missing parent, directory path, unreadable existing file, corrupt SQLite header, incompatible future schema, migration failure, and integrity failure must block collection without replacing or truncating the file.

- [ ] **Step 2: Configure durability**

On every open, enforce `foreign_keys = ON`, `journal_mode = WAL`, `busy_timeout = 5000`, and `synchronous = FULL`. Verify returned pragma values. Run `quick_check` on normal start and `integrity_check` before formal start/export.

- [ ] **Step 3: Create version 1 schema in one transaction**

Create all eight local tables from the spec, attempt-scoped uniqueness, composite FKs, immutable metadata snapshot, UTC millisecond timestamps, integer millisecond timing storage, schema migration ledger, package registry, and sync log. A failed migration rolls back and preserves the original file.

### Task 15: Export and validate a sealed LOCAL study package

**Files:**
- Create: `lib/local/studyPackage.ts`
- Create: `lib/local/studyPackage.test.ts`
- Create: `scripts/local/export-study-package.mjs`
- Create: `scripts/local/validate-study-package.mjs`
- Modify: `package.json`

**Interfaces:**
- Produces:

```ts
export type LocalStudyPackageV1 = {
  packageVersion: 1;
  minimumSchemaVersion: 1;
  generatedAt: string;
  videos: LocalVideoManifestRow[];
  checksumSha256: string;
};
export type LocalVideoManifestRow = {
  videoId: string;
  filePath: string;
  hasLesion: boolean;
  lesionOnsetSec: number | null;
  isTest: boolean;
  sessionPool: 1 | 2 | 3 | null;
  fileSizeBytes: number;
  fileSha256: string;
};
export type ValidationInput = {
  manifestPath: string;
  videoRoot: string;
  requestedMode: "dev" | "formal";
};
export type ValidatedStudyPackage = {
  manifest: LocalStudyPackageV1;
  canonicalJson: string;
  videosById: ReadonlyMap<string, LocalVideoManifestRow>;
};
export async function validateStudyPackage(input: ValidationInput): Promise<ValidatedStudyPackage>;
```

- [ ] **Step 1: Test canonical manifest validation**

DEV allows the configured test pool. FORMAL requires exactly 40 non-test videos in each pool 1/2/3, 120 unique video IDs and paths, no cross-pool reuse, valid lesion metadata, readable regular MP4s, exact size/hash, compatible versions, and a matching manifest checksum.

- [ ] **Step 2: Implement connected export as an operator command**

The exporter reads current Supabase video metadata through a trusted operator context, resolves files only under `LOCAL_VIDEO_ROOT`, calculates per-file SHA-256/size, sorts by video ID, canonicalizes with RFC 8785, and writes atomically to the operator-selected path. It never embeds Supabase credentials or absolute file paths.

- [ ] **Step 3: Implement offline validation**

```bash
npm run local:validate-package
```

Expected success prints package version, schema version, DEV count, Session 1/2/3 counts, total bytes, checksum, and `FORMAL_READY`; failures print exact video IDs/reasons but not absolute paths.

### Task 16: Implement transactional LOCAL attempt lifecycle

**Files:**
- Create: `lib/local/sqlite/localAssessmentRepository.ts`
- Create: `lib/local/sqlite/localAssessmentRepository.test.ts`
- Modify: `lib/assessment/assessmentRepositoryFactory.ts`

**Interfaces:**
- Implements `AssessmentRepository` and `authorizeCurrentVideo` from Tasks 9/11.

- [ ] **Step 1: Test start and persisted randomization**

Create UUID once, validate package, snapshot exact metadata, select the mode/session pool, shuffle with versioned Fisher-Yates, persist attempt and all queue rows in one transaction, and return Video 1 only after commit. FORMAL requires exactly 40.

- [ ] **Step 2: Test resume and ambiguous attempt selection**

Resume by explicit attempt ID. Participant/session lookup may suggest one in-progress attempt; two in-progress attempts must return a choice list and never select by newest timestamp.

- [ ] **Step 3: Test atomic response/event derivation**

Positive requires marks and summarizes the first final-valid mark. Negative stores null detection time/latency and a separate no-response latency. Preserve negative detection latency. Insert events and response in one transaction, allow only exact duplicate retry, reject differing retry/current-order violations, and advance only after commit.

- [ ] **Step 4: Test terminal transitions**

Completion occurs only when every queue order has one response. Completed/abandoned/invalid attempts reject new rows. Partial sync requires explicit abandon/invalid transition.

- [ ] **Step 5: Fault-injection tests**

Simulate busy DB, event insert failure, response insert failure, disk-full/readonly error, process restart, WAL reopen, and corrupt package. Assert no partial trial and no progress advance.

### Task 17: Make LOCAL collection fully SQLite-authoritative

**Files:**
- Create: `app/api/local/attempts/route.ts`
- Create: `app/api/local/attempts/[attemptId]/responses/route.ts`
- Create: `app/api/local/attempts/[attemptId]/abandon/route.ts`
- Modify: `app/api/assessment/start/route.ts`
- Modify: `app/api/assessment/response/route.ts`
- Modify: `components/AssessmentClient.tsx`
- Modify: `README.md`

**Interfaces:**
- Produces: complete no-auth, no-network LOCAL participant workflow.

- [ ] **Step 1: Route all LOCAL active collection to SQLite**

LOCAL start, resume, queue, video authorization, submission, completion, and abandon routes must never instantiate Supabase clients. Remove transitional connected persistence from LOCAL factory while preserving ONLINE adapters.

- [ ] **Step 2: Keep participant UI minimal**

LOCAL shows participant ID and Session 1/2/3 only. No access code, password, sync control, internal attempt validity, or filesystem path appears in participant UI.

- [ ] **Step 3: Run an offline end-to-end attempt**

Unset all Supabase variables, block network for the process/browser, start on `127.0.0.1`, create participant `LOCALOFFLINE-FORMAL-001`, complete a 40-video formal attempt, restart browser and Next.js mid-session, resume the same attempt/order, and finish. Restart again and confirm Completed is read-only.

- [ ] **Step 4: Verify no network/source leakage**

Browser requests must contain only loopback app/video URLs. Search production output for Supabase calls in LOCAL route chunks and for absolute local paths/ground truth in HTML/JSON/logs.

- [ ] **Step 5: P3 gate**

Run all SQLite/package/video/player tests plus standard gates and a focused code review. Stop for approval before sync work.

---

## Phase 4: Explicit LOCAL-to-Supabase Synchronization

### Task 18: Define canonical immutable sync payloads

**Files:**
- Create: `lib/sync/canonicalPayload.ts`
- Create: `lib/sync/canonicalPayload.test.ts`
- Create: `lib/sync/localAttemptExporter.ts`

**Interfaces:**
- Produces:

```ts
export type SyncAttempt = {
  attemptId: string;
  participantId: string;
  sessionNumber: 1 | 2 | 3;
  runtimeChannel: "local";
  studyMode: "dev" | "formal";
  status: "completed" | "abandoned" | "invalid";
  validForAnalysis: false;
  replacesAttemptId: string | null;
  startedAt: string;
  completedAt: string | null;
  studyPackageChecksum: string;
  schemaVersion: 1;
  createdAt: string;
  updatedAt: string;
};
export type SyncQueueRow = {
  attemptId: string;
  participantId: string;
  sessionNumber: 1 | 2 | 3;
  videoId: string;
  videoOrder: number;
  createdAt: string;
};
export type SyncResponseRow = {
  attemptId: string;
  participantId: string;
  sessionNumber: 1 | 2 | 3;
  videoId: string;
  videoOrder: number;
  answer: boolean;
  correct: boolean;
  responseTimeMs: number;
  videoTimeAtClick: string | null;
  detectionLatencyMs: number | null;
  responseType: "lesion_detected" | "no_lesion_detected";
  videoCompleted: true;
  noResponseLatencyMs: number | null;
  createdAt: string;
};
export type SyncEventRow = {
  attemptId: string;
  participantId: string;
  sessionNumber: 1 | 2 | 3;
  videoId: string;
  videoOrder: number;
  clickIndex: number;
  videoTimeAtClick: string;
  responseTimeMs: number;
  lesionOnsetSec: string | null;
  detectionLatencyMs: number | null;
  overridden: boolean;
  finalValid: boolean;
  createdAt: string;
};
export type SyncPackageManifest = LocalStudyPackageV1;
export type LocalAttemptSyncPayloadV1 = {
  schemaVersion: 1;
  attempt: SyncAttempt;
  queue: SyncQueueRow[];
  responses: SyncResponseRow[];
  events: SyncEventRow[];
  studyPackage: SyncPackageManifest;
};
export function canonicalizeAndHash(payload: LocalAttemptSyncPayloadV1): {
  canonicalJson: string;
  sha256: string;
};
```

- [ ] **Step 1: Fix the wire representation**

Sort queue by order, responses by order, and events by order/click index. Encode every timestamp as UTC ISO-8601 with exactly three fractional digits. Encode media seconds as decimal strings with exactly three digits, and latency/duration as integers, so JSON parsing never changes recorded precision.

- [ ] **Step 2: Test deterministic RFC 8785 hashing**

Same semantic payload from different object insertion order yields the same digest; one field change changes the digest; non-finite numbers, duplicate natural keys, in-progress attempts, package mismatch, and integrity-check failure block export.

- [ ] **Step 3: Freeze the local terminal payload**

Store the SHA-256 before upload. Once digest is stored for a terminal attempt, any local data difference is a local corruption/conflict and must not produce a replacement digest silently.

### Task 19: Design and rehearse the atomic sync and validity RPCs

**Files:**
- Create through CLI: migration named `local_attempt_sync_rpc`
- Create: `supabase/local_attempt_sync.contract.test.mjs`

**Interfaces:**
- Produces service-role-only functions:

```text
private.sync_local_assessment_attempt(p_payload jsonb, p_payload_sha256 text) -> jsonb
private.set_assessment_attempt_validity(p_attempt_id uuid, p_replace_existing boolean, p_reason text) -> jsonb
```

- [ ] **Step 1: Generate the migration only after P3 approval**

```bash
supabase migration new local_attempt_sync_rpc
```

- [ ] **Step 2: Implement one transactional import boundary**

Validate schema/package versions, digest, terminal status, identity, pool, queue continuity, video metadata, correctness, timing, event semantics, replacement identity, and current valid attempt. Take advisory locks for attempt ID and participant/session. Insert attempt/queue/responses/events atomically with original UUID/timestamps and PostgreSQL-generated bigint IDs.

- [ ] **Step 3: Implement Cases A-E exactly**

Return structured `imported`, `idempotent`, or `conflict` results. Identical same-ID payload creates no rows. Different same-ID payload changes no rows. Existing valid attempt never clears automatically. Child failure rolls back all rows.

- [ ] **Step 4: Implement audited validity resolution**

Require trusted operator context, completed selected attempt, explicit replacement confirmation/reason, participant/session advisory lock, and one audit row containing previous/new attempt and operator identity.

- [ ] **Step 5: Security review and restored-copy tests**

Keep functions in `private`, revoke `PUBLIC`/`anon`/`authenticated`, grant only `service_role`, set empty search path, schema-qualify all objects, and run database advisors. Test Cases A-E and rollback against restored data.

- [ ] **Step 6: Stop for separate live sync-migration approval**

Repeat P0 delta check, backup, apply, grants/advisors/count checks, and unchanged-release browser smoke only after approval naming the sync migration.

### Task 20: Add the explicit operator sync command

**Files:**
- Create: `lib/sync/syncClient.ts`
- Create: `lib/sync/syncClient.test.ts`
- Create: `scripts/local/sync-terminal-attempt.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: terminal local attempt and server-only Supabase URL/service-role key.
- Produces: local sync state transitions and operator-readable conflict result.

- [ ] **Step 1: Keep sync outside participant flow**

Add `npm run local:sync -- --attempt-id=8a4db86e-2eb8-4ff7-bffd-46a5f5eea2b3` as the documented example for the explicit operator command. It refuses non-loopback/local mode, missing service-role key, in-progress attempt, failed local integrity, or payload mismatch. It never runs on page load or in the background.

- [ ] **Step 2: Implement sync state transitions**

Use `never_synced|sync_failed|conflict -> syncing -> synced|sync_failed|conflict`. Record local attempt ID, digest, RPC result code, timestamps, and sanitized error. Set `synced_at` only after atomic success or explicit conflict resolution.

- [ ] **Step 3: Test network failure and retries**

Timeout before server acceptance, timeout after acceptance, repeated exact payload, differing payload, package conflict, existing valid attempt, and child rollback must produce deterministic local state without duplicates.

### Task 21: P4 end-to-end synchronization gate

**Files:**
- Modify: `README.md`
- Modify: `docs/environment-and-release-workflow.md`

- [ ] **Step 1: Sync synthetic terminal attempts for Cases A-E**

Use dedicated `LOCALSYNC-*` participant IDs in the approved non-production or live test scope. Read back canonical attempt/queue/response/event rows and compare every natural key, timestamp, mark, answer, and timing value with SQLite.

- [ ] **Step 2: Prove analysis isolation**

Query only `status='completed' AND valid_for_analysis=true` attempts and show no join can fill missing orders from a second attempt.

- [ ] **Step 3: Run standard gates and code review**

Stop for approval before ONLINE Auth work.

---

## Phase 5: ONLINE Account Pool and Supabase Auth

### Task 22: Add private participant account mapping and login throttling

**Files:**
- Create through CLI: migration named `online_participant_auth`
- Create: `supabase/online_auth.contract.test.mjs`

**Interfaces:**
- Produces private account mapping, rate-limit state, and authenticated ownership helpers.

- [ ] **Step 1: Generate migration after P4 approval**

```bash
supabase migration new online_participant_auth
```

- [ ] **Step 2: Create non-exposed private tables**

Create `private.assessment_participant_accounts` exactly as specified and a private rate-limit table keyed by a one-way participant identifier plus coarse client signal. No plaintext password, password hash, access code, or participant-facing email enters public tables.

- [ ] **Step 3: Add ownership helpers**

Private `SECURITY DEFINER` helpers map `auth.uid()` to one active participant, use empty search path/schema-qualified objects, expose no internal email, and have explicit grants only to the functions that require them.

- [ ] **Step 4: Test authorization failures**

Inactive mapping, absent mapping, edited participant ID, another user's attempt, expired JWT, anonymous call, and user metadata manipulation must all fail without revealing account existence.

### Task 23: Provision participant accounts safely

**Files:**
- Create: `scripts/online/provision-participant-accounts.mjs`
- Create: `scripts/online/provision-participant-accounts.test.mjs`
- Modify: `package.json`

**Interfaces:**
- Consumes: coordinator CSV containing participant IDs and an operator-selected credential output path outside Git.
- Produces: one pre-confirmed Supabase Auth user and one private mapping per participant, with one 12-character password reused across Sessions 1-3.

- [ ] **Step 1: Test normalization and password generation**

Reject empty/duplicate/confusable participant IDs. Generate 12 characters from `ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789` using `crypto.randomInt`; never log passwords or send them to browser logs.

- [ ] **Step 2: Implement idempotent provisioning**

Create a deterministic opaque internal email domain representation, call Auth Admin server-side, insert private mapping, and compensate by deleting/revoking the new Auth user if mapping insertion fails. Existing matching mapping returns unchanged; conflicting Auth/mapping identity stops.

- [ ] **Step 3: Protect coordinator output**

Write participant ID/password once to an operator-specified file opened with mode `0600` outside the repository. Stdout reports counts only.

### Task 24: Add participant-ID/password sign-in Edge Function

**Files:**
- Create: `supabase/functions/participant-sign-in/index.ts`
- Create: `supabase/functions/participant-sign-in/deno.json`
- Test: `supabase/functions/participant-sign-in/index.test.ts`

**Interfaces:**
- Consumes: `{ participant_id, password }`.
- Produces: normal Supabase Auth session response or one generic invalid-credential response.

- [ ] **Step 1: Test privacy and throttling**

Unknown participant, wrong password, inactive mapping, wrong internal mapping, and throttled request return the same generic status/body. Password/internal email/service key never appears in logs or responses.

- [ ] **Step 2: Implement trusted lookup and normal password sign-in**

The Edge Function uses its service context only to resolve the private internal email, then performs normal Supabase password sign-in. It returns session tokens required by `supabase-js`, applies the database-backed rate limit, and clears/ages successful counters without exposing account existence.

- [ ] **Step 3: Deploy only to an approved non-production/test function name first**

Inspect current CLI docs/help, deploy, verify JWT/session issuance, and run logs/security review. Live deployment requires separate approval and does not alter the legacy function.

### Task 25: Add authenticated attempt RPCs and v2 private-video function

**Files:**
- Create through CLI: migration named `online_attempt_rpc_v2`
- Create: `supabase/functions/issue-assessment-video-url-v2/index.ts`
- Create: `supabase/functions/issue-assessment-video-url-v2/deno.json`
- Create: `lib/online/onlineAssessmentRepository.ts`
- Create: `lib/online/remoteVideoAccessGateway.ts`
- Create: `lib/supabase/browserClient.ts`

**Interfaces:**
- Produces versioned authenticated APIs accepting attempt/session/trial data without trusted participant ID.

- [ ] **Step 1: Implement v2 RPC ownership/current-order enforcement**

Start/resume and submit functions require `auth.uid()`, derive participant through private mapping, validate channel/session/status/attempt ownership, select or explicitly request an in-progress attempt, and enforce first-unanswered order. Do not trust editable metadata or browser participant ID.

- [ ] **Step 2: Implement v2 video authorization**

The Edge Function requires user JWT, receives attempt ID/order only, validates ownership and first unanswered order through v2 RPC, signs exactly one private bucket/path, and returns signed URL/order/expiry. Anonymous/direct Storage access remains denied; no LOCAL fallback exists.

- [ ] **Step 3: Configure browser Auth safely**

Use publishable URL/key only. Persist and refresh the user session for ONLINE. Never place service role, internal email, password, signed URL, or local paths in logs.

- [ ] **Step 4: Rehearse migration and functions**

Run ownership, RLS, grant, advisor, JWT, signed-video, duplicate response, resume, and three-session tests in the approved test environment. Stop for explicit live migration/function deployment approval.

### Task 26: Replace ONLINE access-code UI with Auth while preserving LOCAL no-auth

**Files:**
- Modify: `components/AssessmentClient.tsx`
- Modify: `components/AssessmentFlow.test.mjs`
- Create: `components/OnlineAuthentication.test.mjs`
- Modify: `.env.production.example`
- Modify: `README.md`

**Interfaces:**
- Consumes: server-provided deployment mode and Tasks 24/25 adapters.
- Produces: LOCAL participant/session intake and ONLINE participant/password/session intake.

- [ ] **Step 1: Test mutually exclusive intake forms**

LOCAL has no password/access code and works without Supabase variables. ONLINE requires participant ID/password/session and has no Study access code. Browser attempts to force LOCAL mode cannot change server route behavior.

- [ ] **Step 2: Implement ONLINE sign-in/session lifecycle**

Sign in through `participant-sign-in`, bind UI participant display to the authenticated mapped account, handle expired/revoked sessions by returning to login, and reuse one account across Sessions 1-3.

- [ ] **Step 3: Real-browser ONLINE verification**

Verify valid/invalid login, impersonation attempt, Sessions 1-3 isolation, queue creation/resume, current video, direct private Storage denial, marks, yes/no, duplicate retry, completion, logout, and expired session. ONLINE must not open SQLite or access local routes.

- [ ] **Step 4: P5 gate**

Run focused tests, standard gates, Supabase advisors, and one overall code review. Keep old access-code APIs, legacy Edge Function, `release`, and ECS unchanged. Stop for release approval.

---

## Phase 6: Explicit Manual Release Promotion

### Task 27: Promote only after explicit production approval

**Files:**
- Modify only after approval: `docs/environment-and-release-workflow.md`
- Modify only after approval: `docs/alibaba-ecs-deployment.md`
- Do not create CI/CD, webhook, scheduled deployment, or automatic sync files.

**Interfaces:**
- Consumes: approved P5 commit set and known-good release SHA.
- Produces: manually promoted `release` and verified ECS deployment.

- [ ] **Step 1: Record all branch/deployment SHAs**

Record local `main`, `origin/main`, local `release`, `origin/release`, and current ECS SHA. The expected pre-promotion ECS/release baseline remains `d4957edd455e7f99bc71cbde09c23254edabcfac` unless a separately documented deployment changed it.

- [ ] **Step 2: Present the exact promotion set**

Use fast-forward only when every intervening commit is approved; otherwise cherry-pick only named approved commits. Do not merge unrelated `main` work. Obtain explicit promotion approval before changing `release`.

- [ ] **Step 3: Validate `release` before push**

```bash
npm ci
npm run typecheck
npm test
npm run build
git diff d4957edd455e7f99bc71cbde09c23254edabcfac..HEAD --check
```

Verify `.env.production.local`, service-role values, credential exports, SQLite/package files, local paths, dumps, and videos are absent from commits.

- [ ] **Step 4: Push and manually deploy ECS only after approval**

On ECS: record previous SHA, fetch origin, switch to `release`, pull `--ff-only`, `npm ci`, typecheck, test, build, restart PM2 with updated environment, and run HTTP/Auth/attempt/queue/signed-video/response/resume/completion/analysis smoke tests. Port 3000 remains bound to `127.0.0.1`; Nginx exposes port 80/HTTPS later.

- [ ] **Step 5: Roll back on any failed smoke test**

Checkout the recorded previous known-good release commit/tag, run `npm ci`, build, restart PM2, and repeat verification. Database compatibility must allow the old release to continue through this rollback window.

- [ ] **Step 6: Delay Stage D cleanup**

Do not revoke/remove old access-code RPCs, old Edge Function, `assessment_session_access`, or `assessment_enrollments` in this release. After a separately approved rollback window, generate a new migration with `supabase migration new remove_legacy_access_code_stage_d`, prove no active old client depends on it, back up, rehearse, obtain explicit approval, and preserve all attempts/queues/responses/events.

---

## Final Verification Matrix

- [ ] P0 report proves actual live schema, constraints, indexes, RPC signatures, owners/grants, RLS/policies, Storage policies, Edge Functions, runtime config, table existence, row counts, integrity findings, and migration history.
- [ ] Legacy backfill is deterministic, idempotent, lossless, and blocks ambiguity.
- [ ] Unchanged `d4957ed` works through approved compatibility stages.
- [ ] LOCAL works from a new formal start through 40-video completion with all network disabled.
- [ ] LOCAL browser/process restart resumes the exact same attempt and order.
- [ ] LOCAL current-video route passes 200/206/416/HEAD and traversal/symlink/current-order tests.
- [ ] LOCAL collection never invokes Supabase; ONLINE never invokes SQLite/local files.
- [ ] Sync is explicit, terminal-only, atomic, digest-idempotent, conflict-preserving, and read back field-for-field.
- [ ] No analysis query combines attempts; validity selection is explicit and audited.
- [ ] ONLINE Auth binds `auth.uid()` to participant ownership and resists participant-ID editing.
- [ ] Private Storage remains private and every signed URL is attempt/current-order authorized.
- [ ] Study access code remains only in the legacy rollback bridge until separately approved Stage D cleanup.
- [ ] `release` and ECS remain unchanged until Phase 6 receives explicit promotion approval.
- [ ] Every phase passes focused tests, `npm run typecheck`, `npm test`, `npm run build`, and its review checkpoint.
