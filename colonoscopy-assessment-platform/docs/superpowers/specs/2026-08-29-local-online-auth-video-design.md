# Local and Online Authentication, Attempts, and Video Delivery Design

Date: 2026-08-29

Status: Revised final design for approval. This document contains no
application implementation and authorizes no database migration.

## 1. Decision summary

The project remains one Next.js codebase with two independently operated
environments:

| Environment | Git branch | Runtime | Participant identity | Video source | Active-attempt persistence |
| --- | --- | --- | --- | --- | --- |
| LOCAL | `main` | Mac, loopback-only | Participant ID and session only; no password or access code | Files outside Git, streamed through Next.js | Local SQLite, fully offline |
| ONLINE | `release` | Alibaba Cloud ECS | Supabase Auth using participant ID and participant-specific password | Private Supabase Storage signed URL | Supabase in real time |

LOCAL has two roles:

1. the primary development and iteration environment; and
2. a complete, production-capable emergency experimental fallback that can run
   a new formal session without ECS, Supabase, or Internet connectivity.

ONLINE remains the public participant-facing environment. It changes only after
explicit manual promotion to `release` and manual ECS deployment.

The canonical experimental hierarchy is now:

```text
participant_id
  -> session_number
      -> attempt_id
```

Each attempt is an independent execution unit. It owns one queue, its responses,
its lesion events, its progress, and its completion state. It has one immutable
runtime channel, `local` or `online`, and never crosses channels.

There is no seamless cross-channel continuation. If an ONLINE attempt stops at
15/40, a replacement LOCAL attempt starts at Video 1 with its own queue. The two
attempts are never combined into one formal session result.

## 2. Superseded rules

This revision explicitly supersedes the following rules from the previous
version of this specification:

- A participant/session may belong permanently to only LOCAL or ONLINE.
- Cross-channel ownership prevents a replacement attempt.
- LOCAL requires live Supabase for start, resume, response submission, or video
  authorization.
- LOCAL is only a development convenience.
- A global participant/session queue is the only unit of progress.

The replacement rules are:

- A participant/session may have multiple attempts.
- Every attempt has one immutable runtime channel.
- Attempts do not share queue rows, response rows, event rows, or progress.
- LOCAL active collection is SQLite-authoritative and requires no network.
- ONLINE active collection is Supabase-authoritative.
- Cross-channel recovery means creating a new attempt from Video 1, not merging
  or continuing an old attempt.
- Raw attempts are retained and formal analysis uses an explicitly selected
  valid completed attempt.

Any stale cross-channel session-binding language in the earlier design is void.

## 3. Preserved study behavior

Both channels preserve the full assessment semantics:

- participant ID;
- Sessions 1, 2, and 3;
- DEV and FORMAL study modes;
- exactly 40 videos from the requested session pool in FORMAL mode;
- no formal video reuse across Session 1, 2, and 3 pools;
- one persisted randomized order per attempt;
- resume within the same attempt;
- first-unanswered-order enforcement;
- no duplicate trial submission;
- exact retry idempotency;
- the approved first-play seek restriction and replay behavior;
- repeated `Lesion detected` marks;
- pending mark deletion and renumbering;
- mutually exclusive yes/no classification;
- no-lesion override semantics;
- `video_time_at_click`;
- `response_time_ms`;
- `detection_latency_ms`, including negative values;
- `lesion_detection_events` audit semantics;
- completion and dynamic queue length;
- the existing response schema and analysis meaning.

For first-play behavior, this design adopts one explicit state machine: before
the first real `ended` event, the participant cannot seek beyond the furthest
naturally watched point; seeking backward within watched content is allowed.
After the first `ended` event, free seeking and replay are allowed. This rule
supersedes any earlier language permitting unrestricted forward seeking during
the first pass.

## 4. Goals and non-goals

### Goals

1. Complete a brand-new formal 40-video attempt on the Mac with no network.
2. Recover that same LOCAL attempt after browser, Next.js, or Mac restart.
3. Preserve every raw ONLINE and LOCAL attempt without silent deletion.
4. Synchronize terminal LOCAL attempts into the existing Supabase analysis
   tables without duplicate or overwritten data.
5. Replace ONLINE Study access codes with Supabase Auth participant accounts.
6. Keep private Supabase Storage and current-video authorization ONLINE.
7. Keep local files outside Git and deliver them with standards-compliant Range
   streaming.
8. Keep the current ECS release operational throughout approved development and
   staged migration work.

### Non-goals

- No seamless ONLINE-to-LOCAL continuation within one attempt.
- No merging partial attempts to manufacture one complete session.
- No automatic background synchronization in the first version.
- No automatic failover from Supabase persistence to SQLite mid-attempt.
- No RDS or OSS migration.
- No `local_path` column.
- No videos in `public/` or Git.
- No participant self-registration or participant-facing email.
- No administrator drag-and-drop editor or Survey Creator.
- No CI/CD, webhook, or automatic deployment.
- No change to `release` or the running ECS during this design revision.

## 5. High-level architecture

### 5.1 Final LOCAL architecture

```text
LOCAL browser on Mac
  -> server-rendered mode: local
  -> Next.js LOCAL routes, Node.js runtime, loopback-only
     -> SQLite attempt database
        -> assessment_attempts
        -> assessment_queue
        -> responses
        -> lesion_detection_events
        -> video metadata snapshot
        -> sync state
     -> sealed LOCAL study package
        -> exact DEV/FORMAL metadata and pool assignment
        -> lesion ground truth
        -> package/schema version and checksum
     -> LOCAL_VIDEO_ROOT
        -> database-authorized relative videos.file_path
        -> HTTP Range stream

Operator explicitly chooses Sync
  -> server-only Supabase sync RPC
  -> attempt-aware Supabase study tables
  -> conflict or idempotent success
```

SQLite is authoritative for every final LOCAL attempt, even when Internet is
available. Connectivity enables explicit synchronization only. This avoids a
split-brain attempt whose early rows are in Supabase and later rows are local.

### 5.2 ONLINE architecture

```text
ONLINE browser on ECS
  -> server-rendered mode: online
  -> participant ID + participant password
  -> Supabase Auth account mapping
  -> authenticated, attempt-aware ONLINE RPCs
     -> Supabase assessment_attempts
     -> Supabase assessment_queue
     -> Supabase responses
     -> Supabase lesion_detection_events
  -> authenticated current-video Edge Function
     -> attempt-aware current-order authorization
     -> private Supabase Storage signed URL
```

### 5.3 Application boundaries

Shared player and assessment components depend on narrow contracts:

```ts
interface AssessmentRepository {
  createOrResumeAttempt(input: StartInput): Promise<AssessmentAttemptSession>;
  submitResponse(submission: AttemptVideoSubmission): Promise<void>;
  markAttemptAbandoned(attemptId: string): Promise<void>;
}

interface VideoAccessGateway {
  getCurrentVideo(input: AttemptVideoInput): Promise<VideoPlaybackSource>;
}
```

The LOCAL repository uses SQLite and the local stream route. The ONLINE
repository uses authenticated Supabase RPCs and the signed-video Edge Function.
The player receives a playback URL and attempt context; it contains no
filesystem, Storage, Auth, or sync logic.

## 6. Canonical assessment attempt model

### 6.1 Supabase model

Add `public.assessment_attempts` with at least:

```text
attempt_id uuid primary key
participant_id text not null
session_number integer not null check between 1 and 3
runtime_channel text not null check in ('local', 'online')
study_mode text not null check in ('dev', 'formal')
status text not null check in ('in_progress', 'completed', 'abandoned', 'invalid')
valid_for_analysis boolean not null default false
replaces_attempt_id uuid null
started_at timestamptz not null
completed_at timestamptz null
synced_at timestamptz null
sync_state text not null
sync_payload_sha256 text null
study_package_checksum text null
schema_version integer not null
created_at timestamptz not null
updated_at timestamptz not null
```

The additional fields are necessary:

- `study_mode` freezes the pool-selection meaning of the attempt.
- `sync_state` distinguishes `never_synced`, `syncing`, `synced`,
  `sync_failed`, and `conflict`.
- `sync_payload_sha256` makes a repeated upload comparable and idempotent.
- `study_package_checksum` preserves LOCAL package provenance.
- `schema_version` rejects incompatible offline payloads.
- `updated_at` supports terminal-state and explicit-resolution auditing.

Rules:

- New attempt IDs are random UUIDs generated once at the authoritative source:
  SQLite for LOCAL and PostgreSQL for ONLINE.
- Add a unique database constraint on
  `(attempt_id, participant_id, session_number)` so child tables can enforce
  identity consistency with composite foreign keys.
- `runtime_channel`, participant ID, session number, study mode, package
  checksum, and schema version are immutable after attempt creation.
- `valid_for_analysis = true` requires `status = 'completed'`.
- At most one attempt per participant/session may be valid for analysis, enforced
  by a partial unique index on `(participant_id, session_number)` where
  `valid_for_analysis = true`.
- `replaces_attempt_id` cannot equal `attempt_id` and must identify an attempt
  with the same participant ID and session number.
- A disconnected LOCAL attempt may start with `replaces_attempt_id = null` when
  the failed ONLINE attempt UUID is not available. Before sync, the operator may
  set this field once, or the conflict workflow may explicitly link it to a
  selected incomplete ONLINE attempt. The sync RPC validates the relationship.
- A replacement relationship does not copy data and does not automatically
  change validity.
- ONLINE attempts are server-native and use `sync_state = 'synced'` with
  `synced_at = null`; `synced_at` is reserved for imported LOCAL data.
- LOCAL attempts begin `never_synced` in SQLite. Supabase receives their final
  sync state through the controlled sync transaction.

### 6.2 Status transitions

Allowed first-version transitions are:

```text
in_progress -> completed
in_progress -> abandoned
in_progress -> invalid
completed   -> invalid      only through explicit operator resolution
abandoned   -> invalid      only through explicit operator resolution
```

Completed, abandoned, and invalid attempts are terminal for data collection.
They cannot resume or accept additional trial rows. A partial LOCAL attempt must
be marked abandoned or invalid before synchronization; first-version sync does
not upload a still-editable `in_progress` snapshot.

### 6.3 Analysis validity

Completion does not silently confer analytical validity. A completed attempt is
a candidate until an authorized operator explicitly designates it.

Use a protected operator function that:

1. takes an advisory lock for participant/session;
2. verifies the selected attempt is completed;
3. clears any previously valid attempt only after explicit confirmation;
4. sets the selected attempt valid;
5. records operator, timestamp, previous attempt, selected attempt, and reason in
   a small `assessment_attempt_validity_decisions` audit table.

This audit table stores decisions, not duplicate response data.

## 7. Attempt-aware study table relationships

The existing permanent analysis tables remain canonical. Do not create parallel
permanent response or event tables.

Add `attempt_id uuid` to:

- `assessment_queue`;
- `responses`;
- `lesion_detection_events`.

Final constraints are attempt-scoped:

### `assessment_queue`

- foreign key `(attempt_id, participant_id, session_number)` to the matching
  attempt identity;
- unique `(attempt_id, video_order)`;
- unique `(attempt_id, video_id)`;
- preserve indexes on participant/session for export and audit queries.

### `responses`

- foreign key `(attempt_id, participant_id, session_number)` to the attempt;
- composite queue relationship proving that attempt, video ID, and video order
  identify a real queued trial;
- unique `(attempt_id, video_order)`;
- preserve all existing response columns and their meaning.

### `lesion_detection_events`

- foreign key `(attempt_id, participant_id, session_number)` to the attempt;
- composite queue relationship to the exact queued trial;
- unique `(attempt_id, video_order, click_index)`;
- preserve event timing and audit flags exactly.

The final response and event RPCs derive participant/session from the attempt and
reject payloads whose duplicated identity fields differ. The existing text
participant/session columns remain for direct analysis/export and backward
compatibility; `attempt_id` adds execution-unit identity rather than replacing
those fields.

## 8. Existing uniqueness constraints and live-release compatibility

### 8.1 Current constraint problem

The current schema assumes one attempt per participant/session:

- queue order uniqueness is participant/session/video order;
- queue video uniqueness is participant/session/video ID;
- response uniqueness is participant/session/video/video order;
- lesion click uniqueness is participant/session/video/click index.

Simply adding `attempt_id` while leaving these constraints would block a
replacement attempt. Simply dropping them would allow the current access-code
RPCs, which query only participant/session, to mix multiple attempts.

Therefore attempt support requires a staged compatibility bridge. It cannot be
enabled by a one-step constraint rewrite while ECS still uses the legacy API.

### 8.2 Deterministic legacy attempt backfill

For every distinct participant/session present in the union of queue, response,
and event tables, create exactly one legacy ONLINE attempt. Historical attempts
are classified `online` because their execution depended on live Supabase data
and private Supabase Storage, regardless of whether the browser happened to run
on localhost or ECS.

Use UUIDv5 with one fixed migration namespace and the exact value:

```text
participant_id + unit-separator + session_number
```

This makes reruns resolve to the same UUID. The migration must preflight the
`uuid-ossp` extension or provide an independently tested equivalent UUIDv5
function; it must not use unstable row order or a newly generated UUID on every
run.

Backfill derivation:

- `started_at`: earliest queue `created_at`, otherwise earliest child timestamp;
- `created_at`: same preserved earliest source timestamp where available;
- `completed`: only when every queued order has a response;
- otherwise `in_progress`, never silently `abandoned`;
- `completed_at`: latest response timestamp only for a complete attempt;
- `valid_for_analysis`: false until explicit operator review;
- `study_mode`: historical access/session binding where available; otherwise an
  exact eligible-pool comparison that must have one unambiguous match;
- `sync_state`: `synced` because the data already reside in Supabase;
- `synced_at`: null because no LOCAL import occurred.

If orphan rows, ambiguous mode, duplicate queue orders, or inconsistent child
identity prevent a lossless mapping, migration stops and reports the exact rows.
It never deletes or silently repairs them.

### 8.3 Compatibility bridge for the current ECS release

The current ECS release at
`d4957edd455e7f99bc71cbde09c23254edabcfac` calls the existing access-code RPC
signatures and current video Edge Function. To preserve it:

1. Add nullable `attempt_id` columns and the attempt table additively.
2. Backfill legacy attempt IDs.
3. Add `attempt_id` to the historical session-access binding so each old
   participant/session access code resolves one legacy ONLINE attempt.
4. Replace the bodies, but not names, signatures, return shapes, credential
   behavior, or error contract, of the existing access-code start, submit, and
   video-authorization RPCs.
5. Scope every old-function queue, response, event, and progress query to its
   bound legacy attempt.
6. Keep the old Edge Function contract unchanged during this compatibility
   period.
7. Add a defensive insert trigger that fills a null `attempt_id` only from one
   unambiguous historical access binding; reject ambiguous inserts.

The bridge must be deployed and real-browser tested against the unchanged ECS
release before old participant/session uniqueness constraints are removed.

### 8.4 Constraint transition

Use these stages:

**Stage A - additive only**

- Create attempts and nullable attempt columns.
- Backfill and validate.
- Create attempt-aware unique indexes where they do not conflict.
- Keep all old unique indexes.
- Do not create a second Supabase attempt for an existing participant/session.

**Stage B - legacy API bridge**

- Make old RPC implementations attempt-aware behind unchanged signatures.
- Bind each historical access record to its legacy attempt.
- Test queue creation, resume, signed video, response submission, and completion
  from the unchanged ECS release.
- Keep dedicated LOCAL development participant IDs separate from active ONLINE
  records.

**Stage C - activate multiple attempts**

- Enter a controlled migration window.
- Recheck counts, duplicates, null attempt IDs, and bridge behavior.
- Drop the old participant/session unique indexes.
- Activate the attempt-aware unique constraints.
- Set child `attempt_id` columns not null only after every row is backfilled.
- Keep the old access-code API bridge operational for rollback.

After Stage C, the old ECS release still sees only its access-bound legacy
attempt because its RPC bodies are attempt-scoped. It does not see replacement
LOCAL attempts.

**Stage D - delayed access-code cleanup**

- Occurs only after the new ONLINE Auth release and a separately approved
  rollback window.
- Revoke and remove old access-code RPC signatures, the old Edge Function, and
  obsolete access tables.
- Do not drop attempts or any queue, response, or event row.

No shared Supabase stage is executed merely because this design is committed.
Every stage requires a live-schema audit and separate approval.

## 9. LOCAL SQLite database

### 9.1 Authority and durability

The final LOCAL application uses one server-side SQLite database outside Git.
The browser never opens SQLite directly. All LOCAL assessment operations run in
Next.js Node.js Route Handlers or server modules.

Configure SQLite with:

- foreign keys enabled;
- WAL journaling;
- a non-zero busy timeout;
- `synchronous = FULL` for formal collection;
- transactions for attempt creation, queue creation, response/event commit, and
  status changes;
- schema migrations keyed by an integer schema version;
- an integrity check before formal use and before sync export.

The database file and WAL files live in an operator-controlled data directory
outside the repository. They survive browser refresh, browser close, Next.js
restart, Mac sleep, and Mac restart.

### 9.2 Minimum local schema

SQLite mirrors the canonical concepts rather than copying the entire Supabase
platform schema:

- `local_assessment_attempts`;
- `local_assessment_queue`;
- `local_responses`;
- `local_lesion_detection_events`;
- `local_video_metadata_snapshot`;
- `local_study_packages`;
- `local_sync_log`;
- `local_schema_migrations`.

Required state includes attempt metadata, participant/session, channel, study
mode, randomized queue, all response fields, all event fields, completion,
sync state, exact video metadata snapshot, formal session pools, lesion ground
truth, package checksum, and schema version.

SQLite uses the same attempt-scoped uniqueness rules as final Supabase. IDs and
timestamps are generated once and preserved during sync. Store timestamps as
UTC ISO-8601 values with millisecond precision. Store media time with the same
millisecond precision used by current responses/events.

Only the UUID `attempt_id` is shared as a locally generated canonical identifier.
SQLite may use private local row IDs internally, but it never sends those values
as `responses.id`, `assessment_queue.id`, or `lesion_detection_events.id`.
PostgreSQL continues generating those bigint identity columns; attempt-scoped
natural keys match imported child rows idempotently.

### 9.3 LOCAL attempt lifecycle

1. Validate the selected study package before allowing a formal start.
2. Create a UUID and `in_progress` LOCAL attempt in one transaction.
3. Select the exact eligible pool from the local metadata snapshot.
4. Randomize the pool once using a versioned, tested shuffle implementation.
5. Persist every queue row before presenting Video 1.
6. Resume only by `attempt_id`; participant/session alone may return multiple
   attempts and cannot choose silently.
7. Commit events and the final response atomically for each video.
8. Advance only after the SQLite transaction succeeds.
9. Mark completed only when every persisted queue order has one response.
10. Keep abandoned and invalid attempts read-only and auditable.

Closing or restarting the app resumes the same selected LOCAL attempt. It never
creates a replacement automatically.

## 10. LOCAL study package

### 10.1 Package contents

Before formal offline use, prepare and validate a sealed LOCAL study package
while connectivity is available. It contains:

- references to all required MP4 files under `LOCAL_VIDEO_ROOT`;
- exact `video_id` and relative `videos.file_path`;
- `has_lesion` and `lesion_onset_sec`;
- `is_test` and formal `session_pool` assignment;
- DEV/FORMAL configuration needed by the local app;
- package format version and minimum compatible SQLite schema version;
- a canonical manifest checksum;
- per-video file size and SHA-256 checksum for formal packages.

The package manifest is read-only during collection. The attempt stores its
package checksum and a copy of the required metadata snapshot so later changes
to a package cannot change an existing attempt's meaning.

### 10.2 Formal validation

The operator validation command must prove before formal use:

- Session 1 has exactly 40 non-test videos assigned to pool 1;
- Session 2 has exactly 40 different non-test videos assigned to pool 2;
- Session 3 has exactly 40 different non-test videos assigned to pool 3;
- all 120 formal video IDs and file paths are unique across pools;
- every file exists and is a regular readable MP4;
- every file size and SHA-256 matches the manifest;
- all required lesion metadata are present and valid;
- the package and SQLite schema versions are compatible.

Failure blocks formal attempt creation with an operator-readable package error.
It never falls back to live Supabase metadata.

The package may reference videos in their existing location. This design does
not require relocation. When implementation reaches this phase, the operator
must explicitly configure and validate `LOCAL_VIDEO_ROOT` and the package
manifest path.

### 10.3 Package registry at synchronization

Supabase may store one small package-registry record keyed by package checksum,
containing package/schema versions and the canonical metadata manifest used for
validation. This is provenance, not a parallel response/event table.

At sync, a LOCAL attempt must reference an identical registered package. If the
package is absent, the trusted sync path may register it only after comparing it
with current Supabase video metadata. Any ground-truth or pool mismatch is a
conflict requiring operator review; it is never silently recomputed.

## 11. LOCAL video streaming

### 11.1 Path mapping

Reuse `videos.file_path` as the relative local path:

```text
LOCAL_VIDEO_ROOT=/Users/.../colonoscopy-videos
videos.file_path=video_001.mp4

resolved file=/Users/.../colonoscopy-videos/video_001.mp4
```

Do not add `local_path`. Files remain outside the repository and outside
Next.js `public/`.

### 11.2 Controlled route

Expose a LOCAL-only route such as:

```text
GET /api/local/attempts/{attempt_id}/videos/{video_order}
HEAD /api/local/attempts/{attempt_id}/videos/{video_order}
```

For every request, including every Range request, the server:

1. requires server mode `local`;
2. loads the attempt from SQLite;
3. verifies it is LOCAL and `in_progress`;
4. calculates the first unanswered queue order from SQLite responses;
5. requires the requested order to be that current order;
6. reads only the canonical relative path from the attempt's immutable metadata
   snapshot;
7. resolves and validates the file under `LOCAL_VIDEO_ROOT`;
8. streams the requested bytes.

Knowing a video ID or filename is insufficient. The route never accepts a raw
path and never asks Supabase during active LOCAL collection.

### 11.3 Traversal and symlink protection

Reject empty paths, absolute paths, NULs, `.`/`..` traversal, non-MP4 targets,
directories, and symlinks whose real target leaves the root. Compare
`path.relative(realRoot, realTarget)` after resolving both real paths; string
prefix checks alone are insufficient.

### 11.4 HTTP Range behavior

- No `Range`: `200 OK` complete stream.
- Valid single range: `206 Partial Content`.
- Include `Accept-Ranges: bytes`, `Content-Type: video/mp4`, exact
  `Content-Length`, and `Content-Range` for partial responses.
- Support start-end, open-ended, and suffix ranges.
- Reject malformed, multiple, unsatisfiable, or out-of-bounds ranges with
  `416 Range Not Satisfiable` and `Content-Range: bytes */<size>`.
- `HEAD` returns headers without a body.
- Stream from disk instead of reading the complete MP4 into memory.

A missing authorized file produces a clear LOCAL package/file error containing
the video ID but not the absolute path. There is no Supabase Storage fallback.

## 12. Complete LOCAL feature parity

LOCAL is not a reduced backup screen. It uses the same SurveyJS validation,
player state machine, marking behavior, final classification rules, and timing
semantics as the approved study UI.

The SQLite response transaction must reproduce current server derivation:

- positive classification requires at least one remaining mark;
- its response summary uses the first final-valid mark;
- no classification uploads no marks;
- no detection time is stored for a no response;
- no-response latency is measured separately from the first real ended event;
- detection latency is rounded from video time minus package
  `lesion_onset_sec`, preserving negative values;
- correctness is derived from the immutable package snapshot;
- events and response commit atomically;
- exact duplicate retry succeeds only when every stored field/event matches;
- a differing retry is rejected;
- completion depends on one response per queued order.

The investigator must be able to take the prepared Mac to a doctor, create a
new participant/session attempt, complete all videos, close and reopen the app,
resume the same attempt, and export/sync later without Internet during
collection.

## 13. LOCAL to Supabase synchronization

### 13.1 Explicit operator workflow

First-version synchronization is an explicit command or protected operator
action such as `Sync terminal local attempts`. It does not run invisibly in the
background.

Only `completed`, `abandoned`, or `invalid` LOCAL attempts may sync. An
`in_progress` partial attempt must first be intentionally closed as abandoned or
invalid so the payload becomes immutable.

The local state machine is:

```text
never_synced -> syncing -> synced
                        -> sync_failed
                        -> conflict

sync_failed  -> syncing
conflict     -> operator resolution -> synced or remains conflict
```

`synced_at` is recorded only after an atomic Supabase import or explicit
conflict resolution succeeds.

### 13.2 Canonical payload

Build one immutable payload containing:

- attempt metadata;
- exact queue rows ordered by video order;
- exact responses ordered by video order;
- exact events ordered by video order and click index;
- the original locally generated attempt UUID;
- original UTC timestamps;
- package manifest/checksum and schema version.

Serialize with a documented canonical JSON algorithm and calculate SHA-256.
Store the digest locally before upload and in Supabase after acceptance. Numeric
media/timing values are serialized without conversion through binary floating
point formats that alter their recorded precision.

### 13.3 Atomic sync boundary

Use one service-role-only Supabase RPC, invoked only by the LOCAL server during
an explicit operator action. The RPC:

1. validates schema and package versions;
2. verifies payload SHA-256;
3. takes advisory locks for attempt ID and participant/session;
4. validates attempt status and replacement relationship;
5. validates exact pool, queue continuity, video metadata, correctness, timing,
   and event semantics;
6. applies conflict rules;
7. inserts attempt, queue, responses, and events in one PostgreSQL transaction;
8. returns a structured idempotent success or conflict result.

Any insertion or validation failure rolls back every new row. No partially
imported attempt is visible.

### 13.4 Idempotency

- Locally generated `attempt_id` remains unchanged.
- Existing same attempt ID and identical digest/data returns the original
  success or conflict result without new rows.
- Existing same attempt ID with different digest or any differing row is a hard
  conflict; no row is updated or overwritten.
- Queue, response, and event uniqueness is attempt-scoped, so retry cannot
  duplicate children.
- Original queue order and timestamps are never regenerated.

## 14. Synchronization conflict rules

### Case A - no Supabase attempt for participant/session

Import the attempt and all children atomically. Set `valid_for_analysis = false`
by default. A completed attempt becomes valid only through the explicit operator
decision function.

### Case B - only incomplete ONLINE attempt exists

Import the LOCAL attempt. Keep the ONLINE attempt. If declared,
`replaces_attempt_id` links the LOCAL attempt to the ONLINE attempt. The operator
may select that link during sync when the Mac did not know the ONLINE UUID
offline, mark the old attempt abandoned, and explicitly designate the completed
LOCAL attempt valid. No child rows move between attempts.

### Case C - a completed valid attempt already exists

Import the new raw LOCAL attempt only with `valid_for_analysis = false` and
`sync_state = conflict`; do not clear the existing valid attempt. Preserve all
new raw rows so they are auditable, but leave local `synced_at` unset until the
operator resolves the conflict.

Resolution choices are explicit and audited:

- retain the existing valid attempt and mark the new attempt invalid; or
- replace validity by clearing the old valid flag and selecting the new
  completed attempt in one locked transaction.

### Case D - same attempt ID and identical payload

Return idempotent success. If the prior result was a validity conflict, return
the same conflict until operator resolution.

### Case E - same attempt ID but differing payload

Return a hard conflict. Do not insert, update, delete, or merge anything.

### No mixed-attempt analysis

Formal analysis joins queue, responses, and events through one
`assessment_attempts.attempt_id` where status is completed and
`valid_for_analysis = true`. It never fills missing orders from another attempt.

## 15. ONLINE participant authentication

ONLINE removes Study access code from the participant UI. The form contains:

- participant ID;
- unique participant password;
- Session 1, 2, or 3.

One pre-provisioned Supabase Auth user maps to one participant ID and is reused
across all three sessions. Participants do not self-register and do not see or
type an email address.

Use a non-exposed mapping table:

```text
private.assessment_participant_accounts
  auth_user_id uuid primary key references auth.users(id) on delete restrict
  participant_id text unique not null
  internal_email text unique not null
  active boolean not null default true
  created_at timestamptz not null
  updated_at timestamptz not null
```

Authorization derives participant ID from `auth.uid()` and this table. It never
trusts browser participant ID or editable user metadata. No plaintext password,
password hash, or access code is stored in public application tables.

A trusted coordinator process provisions accounts with Supabase Auth Admin,
pre-confirms the opaque internal email, and generates one random 8-12 character
password, preferably 12 unambiguous characters. Provisioning is idempotent and
compensates if Auth creation succeeds but mapping insertion fails.

An ONLINE sign-in adapter accepts participant ID and password, resolves the
private internal account in a tightly scoped login function, and calls normal
Supabase `signInWithPassword`. It returns one generic invalid-credential error,
never logs the password, and applies rate limiting. Password reset is
coordinator-managed.

## 16. ONLINE attempt and video authorization

ONLINE start/resume creates or loads an ONLINE `assessment_attempts` row. A new
attempt gets a new UUID and its own randomized queue. Resume requires explicit
attempt identity when more than one attempt exists; the system may suggest the
single in-progress attempt but cannot silently merge or replace attempts.

Authenticated start and submit RPCs:

- accept session and attempt/trial payload, not participant ID;
- require `auth.uid()`;
- map it to the active participant account;
- verify attempt ownership, channel, session, status, and current order;
- write only that attempt's rows.

The private-video Edge Function:

1. requires a valid Supabase user JWT;
2. receives attempt ID and video order, not trusted participant ID or path;
3. maps Auth UUID to participant;
4. verifies the attempt is ONLINE, owned by that participant, in progress, and
   targeting the first unanswered order;
5. returns one `bucket` and `file_path` internally;
6. creates one temporary private Storage signed URL;
7. returns only signed URL, order, and expiry metadata.

Private Storage remains private. ONLINE never falls back to local files.

## 17. Study access code removal

The final active UI/API contains no Study access code. Supabase Auth replaces it
ONLINE; loopback-only LOCAL mode requires no credential.

Removal is delayed and staged because the current release still uses the old
contract:

1. Attempt migration first preserves old access-code signatures through the
   attempt-aware compatibility bridge.
2. New LOCAL work uses SQLite and new attempt-aware interfaces.
3. New ONLINE Auth functions and versioned Edge Functions are introduced under
   new names.
4. After the Auth release passes its rollback window, revoke old anonymous
   access-code RPC execution and remove old functions/tables in a separately
   approved cleanup migration.

The uncommitted `supabase/remove_assessment_access_code.sql` is not the final
migration. It combines destructive access-table cleanup with anonymous no-auth
RPC grants and is superseded by this staged attempt/Auth design.

## 18. Environment configuration

### LOCAL `.env.local`

```env
ASSESSMENT_DEPLOYMENT_MODE=local
LOCAL_DATABASE_PATH=/absolute/path/to/local-assessment.sqlite
LOCAL_STUDY_PACKAGE_PATH=/absolute/path/to/study-package.json
LOCAL_VIDEO_ROOT=/absolute/path/to/colonoscopy-videos

# Optional during active offline collection; required only for explicit sync.
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Rules:

- Deployment mode and all local paths are server-only.
- LOCAL starts and completes attempts when every Supabase value is absent.
- Missing sync credentials disable only sync, not collection.
- The server binds to `127.0.0.1`.
- Formal start requires successful package and filesystem validation.

### ONLINE `.env.production.local`

```env
ASSESSMENT_DEPLOYMENT_MODE=online
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

ECS does not configure local database, package, or video paths. Edge Function
secrets remain inside Supabase. A missing/invalid mode fails closed; mode is not
inferred from hostname, port, branch, or a browser flag.

## 19. Error and offline handling

### LOCAL collection

- Missing/corrupt SQLite database: block collection and preserve files for
  recovery; never create a new database over an existing unreadable file.
- SQLite busy/disk-full/write failure: do not advance; keep the current trial
  retryable and display an operator error.
- Mac sleep/restart: reopen SQLite, run integrity/migration checks, and resume the
  selected in-progress attempt.
- Missing package or checksum mismatch: block formal start.
- Missing MP4: identify video ID, not absolute path; no Storage fallback.
- No network: collection remains fully functional; sync is unavailable.
- Network loss during sync: PostgreSQL transaction rolls back or idempotent retry
  detects the accepted payload.

### Attempt errors

- Multiple in-progress attempts: require explicit operator/participant choice;
  do not choose by timestamp silently.
- Completed/abandoned/invalid attempt submission: reject.
- Future/skipped/previous order: reject.
- Replacement link across participant/session: reject.
- Existing valid attempt: sync conflict, not overwrite.

### ONLINE

- Invalid participant/password/inactive mapping: one generic error.
- Expired/revoked session: return to login.
- Mismatched Auth user/attempt: generic authorization error.
- Signed URL failure: remote video error; no LOCAL fallback.

## 20. Security boundaries

1. `ASSESSMENT_DEPLOYMENT_MODE` and filesystem/database paths are server-only.
2. LOCAL is loopback-only and never approved for LAN/Internet exposure.
3. The browser never receives SQLite access, local absolute paths, service-role
   keys, internal emails, or ground-truth metadata.
4. LOCAL video paths come only from the immutable package snapshot and current
   SQLite queue authorization.
5. ONLINE identity comes from Supabase Auth UUID mapping, not browser participant
   ID or user metadata.
6. ONLINE Storage remains private and current-order authorization is repeated at
   the video boundary.
7. LOCAL sync uses a service-role-only atomic RPC and explicit operator action.
8. Attempt validity changes are explicit, locked, and audited.
9. Raw attempts are never silently deleted or merged.
10. Every `SECURITY DEFINER` function has a trusted owner, empty search path,
    schema-qualified objects, explicit validation, and explicit grants.
11. Passwords, JWTs, service keys, local paths, signed URLs, and clinical ground
    truth are excluded from logs.

## 21. Migration safety and required preflight

Before any shared Supabase write:

1. Inspect live tables, columns, constraints, indexes, function signatures,
   owners, grants, RLS, Storage policies, and deployed Edge Functions.
2. Determine whether live state is access-code, no-access-code experimental, or
   mixed. Repository files are not proof.
3. Record counts and hashes for attempts-to-be-derived, queues, responses,
   events, and videos.
4. Audit duplicate orders, duplicate videos, orphan responses/events, queue gaps,
   response completeness, and event linkage.
5. Back up schema and data.
6. Test the compatibility migration against a restored copy and the unchanged
   `d4957ed` application.
7. Obtain explicit approval for each stage that can affect the live release.

If the live state or a legacy mapping is ambiguous, stop with
`BLOCKED_BY_ENVIRONMENT`. Never guess or delete research/test rows.

## 22. Development sequence

Do not implement multiple large phases simultaneously.

### Phase 1 - attempt model and compatibility proof

- Finalize attempt SQL and constraint transition.
- Build migration tests against representative legacy states.
- Prove the unchanged current release works through the compatibility bridge.
- Do not execute the live migration without separate approval.

### Phase 2 - LOCAL connected vertical slice with local video

- Introduce attempt-aware interfaces on `main`.
- Use dedicated test participant IDs.
- Validate controlled local Range playback and full player semantics while
  connected.
- Treat this as a transitional slice, not the final LOCAL persistence model.

### Phase 3 - SQLite offline LOCAL execution

- Add package validation and SQLite schema.
- Make SQLite authoritative for new LOCAL attempts.
- Verify full 40-video formal completion and restart recovery with network
  disabled.

### Phase 4 - explicit LOCAL-to-Supabase sync

- Add canonical payload, digest, atomic sync RPC, retries, and conflict handling.
- Verify Cases A-E and validity decision audit.

### Phase 5 - ONLINE account pool and Supabase Auth

- Provision participant accounts.
- Add authenticated attempt-aware RPC and signed-video paths.
- Remove Study access code from the new ONLINE UI while retaining rollback
  compatibility.

### Phase 6 - manual approved release

- Promote only selected approved commits from `main` to `release`.
- Deploy ECS manually.
- Run HTTP, Auth, attempt, queue, signed-video, response, resume, completion, and
  analysis smoke tests.
- Perform old access-code cleanup only after separate approval and rollback
  window completion.

## 23. Testing and verification

### Attempt and migration tests

- UUIDv5 legacy backfill is stable and idempotent.
- Every old child row receives exactly one correct attempt ID.
- Old API signatures and return shapes remain unchanged during bridge stage.
- Unchanged `d4957ed` can start, resume, authorize video, submit, and complete.
- Old unique constraints are removed only after bridge verification.
- New uniqueness permits separate attempts but rejects duplicates within one
  attempt.
- Composite foreign keys reject participant/session/video mismatches.
- At most one completed attempt is valid per participant/session.
- Existing IDs, timestamps, answers, timing, and event fields are unchanged.

### SQLite and offline tests

- Brand-new participant and formal session start with all network disabled.
- Exactly 40 correct pool videos are randomized and persisted.
- Browser, Next.js, and Mac restart resume the same attempt/order.
- WAL recovery, busy database, disk-full, and failed transaction do not advance.
- Response and events commit atomically.
- Duplicate and differing retries match Supabase semantics.
- Package checksum, pool overlap, missing metadata, missing file, and file hash
  failures block formal start.

### Local video tests

- Full stream returns 200.
- Start-end, open-ended, and suffix ranges return exact 206 bytes.
- Invalid/multiple ranges return 416.
- Seeking restrictions before first end and free replay afterward work in a real
  HTML5 player.
- Traversal, encoded traversal, NUL, absolute path, directory, and escaping
  symlink are denied.
- Future/completed order is denied.
- Supabase and Storage are never called during active LOCAL playback.

### Synchronization tests

- Cases A-E return deterministic outcomes.
- Same digest retry creates no rows.
- Different payload for one attempt ID changes no rows.
- A failed child insert rolls back attempt and all children.
- Original queue order, UUIDs, timestamps, marks, and timing remain exact.
- Existing valid attempt is never silently cleared.
- Explicit resolution records an audit decision.
- Formal analysis never combines attempts.

### ONLINE tests

- Participant ID/password login uses one Auth user across Sessions 1-3.
- Editing participant ID cannot impersonate another account.
- Attempt ownership and current order are enforced by RPC and video function.
- Private Storage direct anonymous access fails.
- ONLINE never reads LOCAL files or SQLite.

### Standard gates

Each implementation phase runs its focused tests plus:

```text
npm run typecheck
npm test
npm run build
```

Live migration requires preflight, restored-copy rehearsal, post-migration
counts/constraints/grants, unchanged-release browser verification, and explicit
human approval.

## 24. Branch and release safety

- `main` remains active development and LOCAL/new-architecture work.
- `release` remains manually approved public ECS code only.
- This design revision changes only documentation on `main`.
- No implementation commit is promoted automatically.
- No GitHub Actions deployment, webhook, CI/CD deployment, scheduled sync, or
  automatic `main -> release` operation is added.
- ECS continues to fetch and deploy only `origin/release`.
- Shared Supabase migrations that can affect the current release are not
  executed until backward compatibility is reviewed and separately approved.
- LOCAL development uses dedicated participant IDs and does not reuse active
  ONLINE participant/session records before attempt-aware migration approval.
- The current ECS directory remains
  `/var/www/deskilling/colonoscopy-assessment-platform`.

## 25. Acceptance criteria

The revised architecture is complete only when:

1. A disconnected Mac can start a brand-new formal participant/session and
   complete all 40 videos.
2. The same LOCAL attempt recovers after browser, process, and Mac restart.
3. LOCAL playback never requires Supabase Storage or live video metadata.
4. LOCAL includes the complete experimental feature set, not a reduced UI.
5. Terminal LOCAL attempts synchronize into canonical Supabase attempt, queue,
   response, and event rows.
6. Sync is atomic, idempotent, preserves original data, and never silently
   overwrites conflicts.
7. An abandoned ONLINE attempt and replacement LOCAL attempt remain separate and
   auditable.
8. No partial attempt is combined with another attempt for analysis.
9. Exactly one completed attempt may be explicitly designated valid per
   participant/session unless the investigator explicitly changes the decision.
10. ONLINE uses pre-provisioned participant-specific Supabase Auth passwords.
11. LOCAL requires no password or access code.
12. Existing queues, responses, events, videos, IDs, timestamps, and constraints
    are preserved through the staged migration.
13. The unchanged current ECS release remains functional through the approved
    compatibility stages.
14. `release` and the running ECS remain unchanged until explicit manual
    approval.

## 26. Supabase references retained for this design

- Password sign-in:
  <https://supabase.com/docs/guides/auth/passwords>
- Server-only Auth account provisioning:
  <https://supabase.com/docs/reference/javascript/auth-admin-createuser>
- Auth-user data mapping:
  <https://supabase.com/docs/guides/auth/managing-user-data>
- Edge Function authorization and JWT verification:
  <https://supabase.com/docs/guides/functions/auth-headers>
- Supabase password storage:
  <https://supabase.com/docs/guides/auth/password-security>
