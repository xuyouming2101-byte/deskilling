# Multi-Lesion Click Audit Design

## Status

Approved by the study owner on 2026-08-21, including the corrected negative-response timing semantics.

## Goal

Allow participants to mark a lesion multiple times while a colonoscopy video plays, require the complete video to be watched, and atomically persist one final mutually exclusive classification plus every raw lesion click for audit.

## Scope

This change covers the participant-facing player, response controls, timing capture, Supabase schema, and atomic submission. It preserves the existing persisted queue, session isolation, resume RPC, signed Storage URLs, unique-response protection, and dynamic queue length.

Survey Creator, administration tools, replay-after-completion, answer revision after submission, session-specific experimental logic, and AI exposure logic remain out of scope.

## Interaction Model

### Playback

- A participant may pause and resume the current video.
- Native seek controls are replaced by task-specific play/pause controls and a read-only progress indicator. Forward seeking is unavailable, so the participant must watch the video from start to the actual HTML5 `ended` event.
- The read-only progress display may show elapsed time and duration, but it must not be interactive.
- Once the video ends, playback controls are locked. The app provides no replay or redo action.

### Lesion detection during playback

- A large red `Lesion detected` button is enabled after playback starts and until the video ends, including while the participant pauses on a frame.
- The button remains enabled after the first click and accepts repeated clicks.
- Each click is appended to an in-memory event list and immediately reflected in the visible click count and event markers/list.
- Each event records its own click index, video time, playback-start elapsed time, and lesion-onset latency.
- A lesion click does not submit anything to Supabase and does not advance the queue.

### Finalization after playback

After the valid `ended` event, the app disables lesion detection and displays `No lesion detected` and `Next video`.

- When one or more lesion clicks exist, `Next video` is enabled. Clicking it finalizes `yes`, uploads the response and all clicks, and advances only after the transaction succeeds.
- When no lesion clicks exist, `Next video` is disabled. The participant must click `No lesion detected`; this finalizes `no`, uploads the response, and advances only after the transaction succeeds.
- `No lesion detected` is available after the video ends even if lesion clicks exist. Clicking it finalizes `no`; all existing clicks remain in the audit payload but become overridden and invalid for formal detection analysis.
- `yes` and `no` are mutually exclusive final classifications.
- When `No lesion detected` is clicked, the visible click count and markers clear immediately. If submission fails, the hidden pending payload retains the raw clicks so retry can persist them as overridden audit events.

## Client State

The current-video state contains:

```ts
type LesionDetectionClick = {
  clickIndex: number;
  videoTimeAtClick: number;
  responseTimeMs: number;
  detectionLatencyMs: number | null;
};

type FinalClassification = "yes" | "no";
```

The player also tracks:

- playback-start `performance.now()`;
- actual-ended `performance.now()`;
- whether playback has started and validly ended;
- the immutable pending submission used for retry;
- whether finalization is saving, failed, or complete.

Switching to a new queue item resets all current-video timing and click state. A successfully saved response is the only event that advances the queue.

## Timing Semantics

All client timings use `performance.now()` for elapsed durations and HTML5 `video.currentTime` for media position.

### Raw lesion clicks

For every click:

- `video_time_at_click` is `video.currentTime`, rounded to millisecond precision in seconds.
- `response_time_ms` is `round(performance.now() - playback_started_at)`.
- `detection_latency_ms` is `round((video_time_at_click - lesion_onset_sec) * 1000)` when `lesion_onset_sec` is not null.
- Negative detection latency is preserved.
- `detection_latency_ms` is null when `lesion_onset_sec` is null.

### Final response summary

For final `yes`:

- `responses.video_time_at_click` uses the first click where `final_valid = true`.
- `responses.response_time_ms` uses that same first valid click's playback-start elapsed time.
- `responses.detection_latency_ms` uses that same first valid click's latency.
- `responses.no_response_latency_ms` is null.

For final `no`:

- `responses.video_time_at_click` is null because no lesion detection time exists.
- `responses.detection_latency_ms` is null.
- `responses.response_time_ms` is the playback-start to `No lesion detected` click duration.
- `responses.no_response_latency_ms` is `round(no_clicked_at - actual_ended_at)`.

`responses.video_completed` is always true for submissions produced by this workflow.

## Database Model

### Existing `public.responses`

Preserve one row per `participant_id + session_number + video_id`. PostgreSQL continues to generate `id` and `created_at`.

Add one nullable column:

```sql
no_response_latency_ms bigint
  check (no_response_latency_ms is null or no_response_latency_ms >= 0)
```

The live database stores `responses.answer` as boolean. The submission function maps final `yes` to `true` and final `no` to `false`.

### New `public.lesion_detection_events`

```sql
create table public.lesion_detection_events (
  id bigint generated by default as identity primary key,
  participant_id text not null,
  session_number integer not null check (session_number between 1 and 3),
  video_id text not null,
  video_order integer not null check (video_order >= 1),
  click_index integer not null check (click_index >= 1),
  video_time_at_click double precision not null check (video_time_at_click >= 0),
  response_time_ms bigint not null check (response_time_ms >= 0),
  lesion_onset_sec double precision,
  detection_latency_ms bigint,
  overridden boolean not null,
  final_valid boolean not null,
  created_at timestamptz not null default now(),
  unique (participant_id, session_number, video_id, click_index),
  check (final_valid <> overridden)
);
```

`lesion_onset_sec` is stored as a snapshot so later metadata edits cannot silently change historical latency interpretation.

For a final `yes`, every submitted click has `overridden = false` and `final_valid = true`. For a final `no`, every submitted click has `overridden = true` and `final_valid = false`. A no-click negative response creates no event rows.

An index on `(participant_id, session_number, video_id, click_index)` supports audit ordering. A partial index on final-valid events supports formal analysis.

## Atomic Submission RPC

Add `public.submit_video_response` and call it through `supabase.rpc(...)`. The function is `SECURITY DEFINER`, is owned by the trusted migration role, uses an explicit empty search path with schema-qualified database objects, and runs all inserts atomically in the caller's transaction. This is the controlled write boundary because anonymous callers have no direct privileges on the response or event tables.

The RPC accepts participant/session/video identity, final classification, final elapsed timing, no-response latency, video-completed state, and a JSON array of raw clicks.

The function validates:

- non-empty participant ID;
- session number `1` through `3`;
- an existing matching `assessment_queue` row and video order;
- final classification is `yes` or `no`;
- video completion is true;
- `yes` has at least one click;
- every click index is unique and contiguous from `1`;
- all media times and elapsed times are non-negative;
- `no_response_latency_ms` is null for `yes` and non-negative for `no`.

The function reads `videos.has_lesion` and `videos.lesion_onset_sec` itself, computes `correct` and latency values, inserts every audit event, then inserts the final response. Any validation error, duplicate response, or insert error rolls back the entire call.

The frontend does not send generated IDs or timestamps.

## Access Control

- Enable RLS on `lesion_detection_events` and retain RLS on `responses`.
- Revoke all table and identity-sequence privileges on `responses` and `lesion_detection_events` from `PUBLIC`, `anon`, and `authenticated`; do not create anonymous insert, select, update, or delete policies for either table.
- Use only the trusted `SECURITY DEFINER` RPC to validate queue identity and derive server-owned fields before writing either table.
- Revoke RPC execution from `PUBLIC` and `authenticated`, then grant it to `anon` only.
- Keep the Storage bucket private and remove every anonymous `storage.objects`
  `SELECT` policy. The browser cannot list, sign, or download assessment objects
  directly.
- Release the current object's `bucket` and `file_path` only through a
  service-role-only authorization RPC. A trusted Edge Function uses that result
  to create the temporary signed URL without exposing the service key.
- Run Supabase security and performance advisors after applying the migration.

## Session and Queue Boundary

Before a participant starts, a coordinator creates one protected
`assessment_enrollments` row for each `participant_id` + `session_number`.
It stores only a SHA-256 digest of a high-entropy access code, an active flag,
and the authorized `study_mode`. Browser roles cannot read this table. The
entered code must contain at least 20 characters, match an active enrollment,
and have the same mode as the single authoritative
`assessment_runtime_config` row. Missing, inactive, wrong-code, and wrong-mode
enrollments all return the same generic credential error.

`assessment_session_access` stores the matched enrollment digest and the
session's mode. A composite foreign key binds that state to the enrollment and
prevents a mode or code change from silently relabeling an active session.
Legacy browser-generated bindings are retained only when they already match an
explicit enrollment; unmatched bindings are removed while queues and responses
remain intact. A legacy queue cannot resume until the coordinator provisions an
enrollment. After provisioning, the queue must still be proven identical to the
authoritative eligible pool: both set directions, equal cardinality, unique
contiguous `video_order` values from `1..N`, no missing video reference, and
exactly 40 eligible and queued videos in FORMAL mode.

`start_or_resume_assessment(participant_id, session_number, access_code)` is the
only browser-accessible queue API. It acquires a participant/session advisory
transaction lock, validates the enrollment and mode, creates the bound access
row and randomized queue only when permitted, and returns only `video_id`,
`video_order`, `next_video_order`, `queue_length`, and authoritative
`study_mode`. It never returns Storage paths, lesion truth, or lesion onset.

`authorize_current_assessment_video(participant_id, session_number,
video_order, access_code)` is executable only by `service_role`. It repeats the
enrollment, mode, and binding checks, then returns exactly one `bucket` and
`file_path` only when `video_order` is the first unanswered queue order.
Completed, previous, skipped, future, wrong-mode, and wrong-code requests fail.
The Edge Function signs only that object. Anonymous Storage listing and signing
are unavailable because the former global helper and anonymous Storage policy
are removed.

Anonymous clients have no direct privileges or policies on `videos`,
`assessment_queue`, `responses`, `lesion_detection_events`, enrollments, or the
access table. The legacy `get_next_video_order` RPC is not browser-callable.

The access-code-bound submission RPC holds the same advisory lock. A new submission
must be the first unanswered queue order. Before that check, an exactly
matching already-committed response and complete derived click-event set is
treated as success, so a lost HTTP acknowledgement can be retried safely. A
different replay is rejected. Server-side code alone reads lesion truth and
onset, computes correctness and signed latency, and derives all event flags.
For a positive response, `response_time_ms` must exactly equal the first click
event's `response_time_ms`; therefore a retry cannot alter the summary while
retaining an otherwise matching event payload.

## SurveyJS and React Responsibilities

SurveyJS remains the final-classification model and validation boundary. React owns the repeated red detection control, per-click timing capture, visible click audit, player state, and final action buttons. The default one-shot SurveyJS radio interaction is replaced because it cannot represent repeated detection events.

## Failure and Retry

- Final controls lock while the RPC is in progress.
- Queue advancement occurs only after a successful RPC result.
- On failure, the immutable pending payload remains available through a retry button.
- A failed final `yes` preserves all valid clicks.
- A failed final `no` preserves overridden raw clicks in the pending payload even though the visible count remains cleared.
- The unique response constraint continues to prevent a second successful submission for the same participant/session/video.

## Verification

Automated tests cover:

- active coordinator enrollment, minimum access-code length, generic credential
  errors, and authoritative mode agreement;
- safe legacy access-binding cleanup before digest/mode constraints;
- browser queue metadata excludes Storage paths;
- service-role-only current-video authorization rejects completed, previous,
  skipped, and future orders;
- anonymous Storage policies and the global object predicate are absent;
- repeated click accumulation and millisecond precision;
- signed and null detection latency behavior;
- `Next video` enablement only after valid end and at least one click;
- `No lesion detected` availability only after valid end;
- positive summary uses the first final-valid click;
- negative summary uses null detection fields and records `no_response_latency_ms`;
- override payload preserves raw clicks while marking all invalid;
- failed submission remains retryable without queue advancement;
- database validation rejects positive submissions with zero clicks;
- RPC writes response and events atomically;
- anonymous clients cannot select responses or event rows.

Browser verification covers desktop and mobile layouts, repeated red-button clicks, disabled controls before video end, both finalization paths, error retry, and transition to the next queued video.
