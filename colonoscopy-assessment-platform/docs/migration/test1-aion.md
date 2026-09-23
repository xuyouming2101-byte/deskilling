# Test 1 AI-ON Integration

## Scope

The separate `/baseline` page accepts Participant ID only. Its server endpoint
accepts exactly P21-P40 and fixes Session 1. It invokes the existing Day 0 claim
and issues the existing participant/session-bound HttpOnly cookie. `/` retains
password/session intake, including subsequent sessions. No player, mark,
submission, timing, Nginx, or video content changes are included.

Formal Session 1 selects AI-ON for P21-P40 and AI-OFF for all other existing
participants. Each pool has 40 videos. Existing queues are validated and reused,
never rebuilt. Session 2/3 and DEV eligibility retain their previous rules.

## Provenance and Migration

`deploy/postgres/aion/20260923_test1_aion.sql` is a single transaction generated
from the approved physical-row audit of `Test 1 manifest.xlsx` (SHA256 included
in the SQL). It inserts 40 separate AI-ON videos and 35 lesion windows. The
original 40 AI-OFF metadata rows and all existing research records are unchanged.
It checks the exact previous start-function definition before replacing only
the four eligibility predicates. It aborts on an already-started P21-P40
Session 1 or an unexpected pool/schema. It is deliberately not an upsert.

No patient names are included. `video_lesions.lesion_type` is NULL because the
audited source supplies video classification, not independent lesion-specific
classification. Video `type` retains that source classification. Zero-length
`[0,0]` is retained exactly as audited, as are both video 23 windows `[72,76]`
and `[91,92]`. `videos.lesion_onset_sec` remains NULL. The application role has
no direct access to the gold-standard table.

## Verification

- `npm test`, `npm run typecheck`, `npm run build`.
- After build: `node --test tests/baseline-intake.test.mjs`.
- Restore a backup into a uniquely named `deskilling_aion_<16 hex>` test DB.
  Apply the migration there first. Set `AION_TEST_DATABASE` and server-only
  `DATABASE_URL` with the restricted `deskilling_app` role, then run:
  `node --conditions=react-server --test tests/aion-integration.test.mjs`.
- Integration tests intentionally write **only** to that isolated copy, test
  P20/P21/P40/P41 boundaries, preserve all other participant fingerprints, and
  add Session 2/3 fixtures only to the disposable test DB. Do not run against
  the canonical database. Test DB evidence is retained.

## Production Boundary

Back up PostgreSQL and preserve the previous app/build before activation.
Do not activate while old code could create AI-ON participants' OFF queues.
Stop the app only after the candidate build and tests pass. Hold the migration
transaction through code/build replacement and app health check; commit only
after successful startup, otherwise roll back and restore the old code/build.
Do not modify active environment, release, existing research rows, or MP4 files.
Production verification uses read-only data checks and signed video delivery;
ID-only successful login is tested in the isolated DB, not by starting real
P21-P40 schedules. A previously accepted app alone is not a safe DB rollback
after AI-ON data collection begins; preserve the split-pool routing and research
records for any subsequent rollback.
