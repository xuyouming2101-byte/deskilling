# Checkpoint B: candidate acceptance complete

Date: 2026-09-14. Branch: `feature/ecs-postgres-canonical`.
Production/release baseline: `b0932491fd99603068b0d7982fad850a2f016ae6`.
The historical fixture blocker is resolved. Fresh regression, typecheck and build
passed. This document accompanies the Checkpoint B feature commit; no release merge
or production deployment is authorized. Earlier stop evidence is retained below.

## Candidate changes

- Added `lib/server/postgres.ts`: server-only, lazy reusable pg pool (max 5),
  finite connect/statement/query timeouts, restricted configured username,
  four fixed parameterized calls, sanitized failures and no Supabase fallback.
- Updated `app/api/online-password/route.ts` to call
  `claim_participant_session_access(text, integer)` after ordinary credentials.
  Master bypass and existing cookie issuance are unchanged.
- Updated `app/api/assessment-session/route.ts` to call
  `start_or_resume_assessment(text, integer)`.
- Updated `app/api/assessment-submit/route.ts` to call
  `submit_video_response(text, integer, text, integer, boolean, bigint, bigint, boolean, jsonb)`.
  Clicks are explicitly JSON.stringify-ed into `$9::jsonb`; saved=true follows
  successful atomic function return only.
- Updated `app/api/formal-video-url/route.ts` to call
  `authorize_current_assessment_video(text, integer, integer)` and check the
  existing participant/session-bound cookie. Existing relative HMAC URL remains.
- Added `lib/assessmentClient.ts` and changed only data entry/configuration calls
  in `components/AssessmentClient.tsx`. ONLINE uses same-origin APIs exclusively;
  legacy non-ONLINE code is lazily imported only in the explicit historical path.
- Updated the four route test files, added `postgresRouteFixture.ts`,
  `postgres.test.ts`, `assessmentClient.test.ts`, and
  `tests/postgres-integration.test.mjs`.
- Added pg, @types/pg, server-only and lockfile changes; Node tests use the
  react-server export condition rather than removing server-only protection.

AssessmentVideoPlayer, LesionSurvey, globals.css, formal-video delivery route,
Supabase files and Checkpoint A schema/seed/bootstrap were not changed.
No real config is in Git. Candidate server configuration is documented below;
existing production configuration is not activated or overwritten in this checkpoint.

## Verification at the earlier stopping point

- Route RED before implementation: 3 passed / 15, expected old Supabase config failures.
- Updated route tests: 15/15 passed.
- Same-origin client execution tests: 2/2 passed.
- Pool/role/type/server-only tests: 3/3 passed.
- `npm run typecheck`: PASS.
- `npm test`: 85/86 passed, one failure described below. No tests skipped.
- `npm run build`: NOT RUN after regression failure, per stop-on-failure boundary.

Real integration used freshly restored `deskilling_b_03d751bdb5ad4892`, from
`/data/deskilling/backups/postgres/20260914_125212Z/`, NOT either A restore DB.
Application calls used the real pg driver and `deskilling_app`; actual current
database/user were asserted before writes. Privileged readback and one injected
failure trigger were restricted to this exact test copy. No main DB writes.

The already-started integration run completed normally: 13/13 checkpoints PASS.
It tested real loopback HTTP requests through the candidate route handlers and
the production browser data client, not a deployed Next.js/public browser session.
Checks cover bad/master/ordinary passwords, Day 0 + 14/28 days, identity cookies,
40-row stable queue, current-only video authorization, positive mark and negative
responses, exact bigint/NULL/JSONB handling, exact/differing retries, injected
atomic rollback, fresh Node-process resume at Video 3, and completion locking.
Test-only final counts: queue 40, responses 40, events 1. These are software-test
records in the isolated copy, never formal collected research data.
All Supabase environment variables were removed; 72 HTTP requests stayed
loopback-only, with fetch/socket guards and zero Supabase calls.

Protected ECS evidence (contains no application credentials in these reports):

- `/root/deskilling-checkpoint-b-2fcff5d92348/state.json`: exact target/creator/purpose.
- `/root/deskilling-checkpoint-b-2fcff5d92348/integration.tap`.
- `/root/deskilling-checkpoint-b-2fcff5d92348/integration-report.json`.
- `/root/deskilling-checkpoint-b-2fcff5d92348/boundary-report.json`.

The candidate directory and test DB are retained. Real test connection config
is protected outside Git; it must not be copied into production.

## Earlier blocking failure and stop (resolved below)

`supabase/multi_lesion_click_audit.contract.test.mjs:566` reads two historical
verification documents and asserts the distinct no-click rollback scenario.
One required file does not exist in this feature worktree OR the baseline Git tree:

`.superpowers/sdd/2026-08-21-multi-lesion-click-audit/task-2-brief.md`

Observed error: `ENOENT`, originating at the readFile in line 570.
`git ls-tree -r --name-only b0932491fd99603068b0d7982fad850a2f016ae6` for that
SDD directory returned no files. The failing contract test itself is unchanged.
Do not delete its assertions, fabricate the missing historical artifact, skip it,
or interpret the other passes as a complete regression gate.

Per user stop-on-failure instruction, no further implementation/build/commit/push
followed. Only the already-running integration was allowed to finish, and
read-only boundary verification/reporting followed. The next authorized action
must address this missing regression artifact without weakening its intended test.

## Production boundary verification at the earlier stop

All checks passed: canonical schema/data/sequence fingerprints and grants equal
the pre-test state, both A restore databases unchanged, previous backups/evidence
byte-identical, production git status/HEAD/PM2 PID/environment/Nginx config and
inactive candidate environment unchanged. Production PID remains 97921.
origin/release remains the baseline SHA above. No Supabase or MP4 operations.

Canonical counts: videos=40, schedule=180, non-NULL opens_at=0,
queue=0, responses=0, lesion_detection_events=0, runtime_config=1.

POSTGRES_ROUTE_TESTS_OK=yes
REAL_POSTGRES_INTEGRATION_TESTS_OK=yes
SUPABASE_FREE_FORMAL_FLOW_TEST_OK=yes (candidate HTTP/data-client integration only)
TYPECHECK_OK=yes
BUILD_OK=not_run
REGRESSION_OK=no
CANONICAL_DB_UNCHANGED=yes
PRODUCTION_APP_CHANGED=no
PRODUCTION_DATABASE_SWITCHED=no
RELEASE_MODIFIED=no
CHECKPOINT_B_COMPLETE=no

## Historical fixture repair and final acceptance

Read the complete contract test. Its final test reads the tracked implementation
plan and the old SDD task brief as UTF-8 text; it never executes the embedded SQL.
For EACH document all four original assertions remain unchanged:

1. `limit 3;` selects three distinct videos for the historical test.
2. Order 3 is first submitted as false with an empty JSONB click array.
3. A PL/pgSQL exception subtransaction catches `unique_violation`.
4. Expected results state that video 3 still has zero events after the failed duplicate.

The missing file was a historical implementer/design instruction document, used
incidentally as textual test input, not an application runtime dependency.
Read-only search covered the main repo, existing worktrees, their hidden
`.superpowers` directories, Documents/Desktop historical directories, current
temporary artifacts and the pre-migration application archive listing.
The accurate original was recovered from the existing multi-lesion-click-audit
worktree. The rollback Git tree and verified application archive do not contain it.

Original full-file SHA256:
`c50eca385beeb6041f2b96f19df12ab61a2a7a4c0c8ae03bf7a64c0b4e8ce7de`.

Only its Step 5 was extracted verbatim into the repo-owned fixture:
`test/fixtures/multi-lesion-click-audit/task-2-brief.md`.
The fixture is labelled inert historical input. No SQL was run from it, and no
source document was modified. Only one path in the contract test changed; no
assertions, tests, skip/only/todo flags or error-ignore paths were added/removed.

Fresh gates after this repair:

- Previously failing test alone: 1/1 PASS, skipped=0.
- New temporary environment containing only repo-owned required files, with no
  `.superpowers` directory in the app or its parent: complete contract file 13/13
  PASS, skipped=0. Extracted Step 5 also compared byte-for-byte with the original.
- Full `npm test`: 86/86 PASS, skipped=0.
- `npm run typecheck`: PASS.
- `npm run build`: PASS, Next.js 16.3.0, all four candidate APIs and the unchanged
  formal-video route built successfully in the isolated worktree.

The prior real integration remains applicable: candidate application/driver and
integration test code were not changed in this repair. Its protected report was
read back and checked: 13/13 checkpoints, 72 loopback requests, zero Supabase calls.
The test DB remains `deskilling_b_03d751bdb5ad4892`, with 40 queue rows, 40 responses,
and one event. It was neither recreated nor reseeded, and no new answers were run.

Fresh read-only boundary report:
`/root/deskilling-checkpoint-b-2fcff5d92348/boundary-report-hermetic.json`.
Canonical data/schema/sequence fingerprints and permissions, production
HEAD/status/PM2 PID/active env/Nginx configuration, inactive candidate env,
previous backup files and both A restore DBs still equal the earlier baseline.
No Supabase or MP4 operations. Canonical counts remain 40 videos, 180 schedules,
zero started schedules, zero queue/responses/events. Production PID remains 97921.

### Candidate configuration and tests

The future ONLINE candidate requires these server-only variable names:
`DATABASE_URL`, `STUDY_SHARED_PASSWORD`, `FORMAL_VIDEO_SIGNING_SECRET`.
No real values are included. DATABASE_URL must authenticate as deskilling_app;
the runtime rejects postgres/owner identities and never falls back to Supabase.
The current production environment/candidate file remains inactive and unchanged.
Historical LOCAL/DEV configuration is not refactored by this checkpoint.

Unit/regression command: `npm test`; server-only tests use the react-server
condition instead of bypassing the server-only boundary.
Real integration command: `npm run test:postgres`, in the isolated ECS candidate
directory, with an explicitly prepared throwaway database and private test env.
It requires matching `CHECKPOINT_B_TEST_DATABASE` and DATABASE_URL, verifies
current_database/current_user before writes, and rejects the canonical DB.
Optional `CHECKPOINT_B_REPORT_PATH` saves a test-only summary outside Git.
Do not rerun this fixture against a completed test DB without separately approved
test-state preparation; do not use the canonical database or either A restore DB.

HISTORICAL_TEST_ROOT_CAUSE_CONFIRMED=yes
HISTORICAL_TEST_HERMETIC_FIX_OK=yes
TARGETED_TESTS_OK=yes
REAL_POSTGRES_INTEGRATION_TESTS_OK=yes
SUPABASE_FREE_FORMAL_FLOW_TEST_OK=yes
TYPECHECK_OK=yes
BUILD_OK=yes
REGRESSION_OK=yes
CANONICAL_DB_UNCHANGED=yes
PRODUCTION_APP_CHANGED=no
PRODUCTION_DATABASE_SWITCHED=no
RELEASE_MODIFIED=no
CHECKPOINT_B_COMPLETE=yes

These results certify candidate code only. Stop for review before Checkpoint C;
the production website has NOT been migrated away from Supabase.
