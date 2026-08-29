# LOCAL Offline Assessment Operator Runbook

This runbook is for the Mac-only emergency experiment runtime on `main`. It
uses local MP4 files and SQLite. It does not use Supabase, Internet access, ECS,
or the public `release` branch.

## Readiness boundary

- `SOFTWARE_LOCAL_OFFLINE_READY` means the software has completed a synthetic
  40-video FORMAL browser test with 120 sealed metadata rows, network access
  blocked, SQLite recovery, and local Range streaming.
- `REAL_FORMAL_PACKAGE_READY` remains `no` until the real 120 study videos,
  final metadata, and final coded participant roster have been independently
  checked and sealed.
- Never use synthetic package metadata or test MP4s for research collection.

## Required local paths

Keep all runtime data outside Git and outside the Next.js `public` directory.
Use absolute paths for all three locations:

```text
LOCAL_VIDEO_ROOT=/absolute/path/to/local-videos
LOCAL_STUDY_PACKAGE_PATH=/absolute/path/to/sealed-study-package.json
LOCAL_DATABASE_PATH=/absolute/path/to/local-assessment.sqlite3
```

The process account needs read access to the sealed package and videos, and
read/write access to the SQLite parent directory. Do not put passwords,
credentials, ground truth, or filesystem paths into the participant UI.

## Build and validate a sealed package

Prepare an operator-reviewed manifest outside Git. Each video uses a stable
`videoId` plus an MP4 path relative to `LOCAL_VIDEO_ROOT`. FORMAL metadata must
contain exactly 120 unique videos: 40 in each `sessionPool` 1, 2, and 3. The
roster CSV must contain one column only:

```csv
participant_id
P001
P002
```

The roster contains coded participant IDs only, never passwords or email
addresses. Build and validate the package:

```bash
cd "/Users/youming/Documents/GI deskilling/colonoscopy-assessment-platform"

npm run build:local-package -- \
  --manifest "/absolute/path/to/reviewed-manifest.json" \
  --video-root "/absolute/path/to/local-videos" \
  --roster "/absolute/path/to/formal-roster.csv" \
  --output "/absolute/path/to/sealed-study-package.json"

npm run validate:local-package -- \
  --package "/absolute/path/to/sealed-study-package.json" \
  --video-root "/absolute/path/to/local-videos"
```

Validation checks the package seal plus every MP4 file size and SHA-256. A
missing, renamed, or changed file is a hard failure. LOCAL never falls back to
Supabase Storage.

## Configure the LOCAL process

Create an uncommitted `.env.local` containing only operator-controlled LOCAL
settings:

```bash
ASSESSMENT_DEPLOYMENT_MODE=local
LOCAL_VIDEO_ROOT=/absolute/path/to/local-videos
LOCAL_STUDY_PACKAGE_PATH=/absolute/path/to/sealed-study-package.json
LOCAL_DATABASE_PATH=/absolute/path/to/local-assessment.sqlite3
```

Do not set `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, or any Supabase secret for an offline
run. The deployment mode is fail-closed; it must be exactly `local`.

## Pre-run gate

From `main`, with no participant session in progress:

```bash
npm ci
npm run validate:local-package -- \
  --package "$LOCAL_STUDY_PACKAGE_PATH" \
  --video-root "$LOCAL_VIDEO_ROOT"
npm run typecheck
npm test
npm run build
```

Record the Git commit SHA, sealed package checksum, and SQLite backup identity
in the operator log. Do not record participant responses or ground truth in
application logs.

## Start the assessment

Bind Next.js to loopback only:

```bash
npm run dev -- -H 127.0.0.1 -p 3000
```

Open `http://127.0.0.1:3000/`. The participant screen must show only:

- Participant ID
- Session 1, Session 2, or Session 3

Unknown FORMAL participant IDs are rejected before an attempt or queue is
created. Queue order is committed to SQLite before Video 1 is returned.

## Recovery

If the browser closes, reopen the page and enter the same Participant ID and
Session. The first unanswered video and the persisted random order are restored.

If Next.js stops, restart the same command with the same three LOCAL paths.
Do not delete or replace the SQLite database. A completed attempt opens directly
on the locked completion page.

## Backup and integrity check

Stop Next.js before copying SQLite so there are no active writers. Preserve the
database and any adjacent `-wal` and `-shm` files as one backup set:

```bash
backup_dir="/absolute/path/to/backups/$(date +%Y%m%d-%H%M%S)"
mkdir -p "$backup_dir"
cp "$LOCAL_DATABASE_PATH" "$backup_dir/"
test ! -f "${LOCAL_DATABASE_PATH}-wal" || cp "${LOCAL_DATABASE_PATH}-wal" "$backup_dir/"
test ! -f "${LOCAL_DATABASE_PATH}-shm" || cp "${LOCAL_DATABASE_PATH}-shm" "$backup_dir/"
```

Run read-only integrity checks against the stopped database:

```bash
sqlite3 "$LOCAL_DATABASE_PATH" "PRAGMA quick_check; PRAGMA foreign_key_check;"
```

Expected output contains `ok` and no foreign-key rows. Keep backups outside Git
with restricted access because SQLite contains participant-level study data.

## Terminal attempt export

Stop Next.js and complete the integrity check before exporting. Write exports
to a restricted directory outside Git:

```bash
export_dir="/absolute/path/to/restricted-export"
mkdir -p "$export_dir"
chmod 700 "$export_dir"

sqlite3 -header -csv "$LOCAL_DATABASE_PATH" \
  "SELECT * FROM local_assessment_attempts ORDER BY created_at, attempt_id;" \
  > "$export_dir/attempts.csv"
sqlite3 -header -csv "$LOCAL_DATABASE_PATH" \
  "SELECT * FROM local_assessment_queue ORDER BY attempt_id, video_order;" \
  > "$export_dir/queue.csv"
sqlite3 -header -csv "$LOCAL_DATABASE_PATH" \
  "SELECT * FROM local_responses ORDER BY attempt_id, video_order;" \
  > "$export_dir/responses.csv"
sqlite3 -header -csv "$LOCAL_DATABASE_PATH" \
  "SELECT * FROM local_lesion_detection_events ORDER BY attempt_id, video_order, click_index;" \
  > "$export_dir/lesion_detection_events.csv"
chmod 600 "$export_dir"/*.csv
```

Keep the four files together and record the source Git SHA, package checksum,
database backup identity, and export time. Do not upload or email these files
without the study's approved data-handling process.

## Failure handling

- `Participant ID is not in the sealed FORMAL participant roster`: verify the
  coded ID against the approved roster. Do not create a new typo-based ID.
- Package checksum or MP4 SHA-256 error: stop collection and restore the
  reviewed package/video set. Do not rebuild the package silently.
- LOCAL video missing or not authorized: verify the current attempt, relative
  `filePath`, package seal, and `LOCAL_VIDEO_ROOT`. Do not expose the absolute
  path to the participant and do not use Supabase fallback.
- SQLite integrity failure, write conflict, or repeated save failure: stop the
  app, preserve the database plus WAL/SHM files, make a backup, and investigate
  before resuming. Only a successfully committed response advances progress.
- A differing duplicate response is rejected. An exact retry of the same
  immutable payload is idempotent.

## Branch safety

LOCAL development and collection use `main`. The public ECS checkout tracks
`release` only. Do not merge, push, deploy, or restart ECS as part of LOCAL
operation. Public promotion remains a separate, explicit manual approval step.
