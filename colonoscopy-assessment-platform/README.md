# Colonoscopy Video Assessment MVP

Minimal Next.js assessment loop:

1. Collect `participant_id` and `session_number` (`1`, `2`, or `3`).
2. Create or reuse a browser-local access token for that participant/session; only its SHA-256 digest is stored in PostgreSQL.
3. Call the token-bound `start_or_resume_assessment(participant_id, session_number, access_token)` RPC. PostgreSQL owns pool selection, randomization, queue persistence, and resume order.
4. Create a six-hour temporary signed URL for each private Supabase Storage object returned by that RPC.
7. Show `Video X / queue length` and play the current video with task-specific, seek-free controls.
8. After playback starts, let the participant use `Lesion detected` repeatedly; each click separately records millisecond-precision media time and playback-start elapsed time.
9. After the actual HTML5 `ended` event, finalize exactly one response: `Next video` submits `yes` when at least one click exists, while `No lesion detected` submits `no` and overrides any prior clicks.
10. Submit the final classification and raw click audit atomically through the token-bound `submit_video_response` RPC, then advance only after a successful response.
11. Show a completion page after every queued video has a saved response.

Survey Creator and admin drag-and-drop editing are not included.

Session interval restrictions and AI exposure logic are not implemented yet;
this MVP only validates the technical multi-session workflow.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Run `supabase/schema.sql` in the Supabase SQL editor.

3. Copy `.env.example` to `.env.local` and fill in:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```

   The app uses the `NEXT_PUBLIC_...` values. `SUPABASE_SERVICE_ROLE_KEY` is
   only used by the local upload helper.

4. Confirm the private Supabase Storage objects exist and the `videos` table contains the eligible assessment videos:

   ```text
   video_id: stable unique ID, for example video_001
   bucket: the private Storage bucket, for example SSL
   file_path: the exact MP4 filename or object path in Supabase Storage
   is_test: true for development videos, false for formal videos
   session_pool: null for test videos; 1, 2, or 3 for formal videos
   ```

   The protected `assessment_runtime_config` table controls the current study
   mode. It defaults to `dev`, which selects `videos` rows where
   `is_test = true`. Session 1, Session 2, and Session 3 may reuse the
   same current test pool, but each participant/session still creates its own
   independent randomized `assessment_queue`.

   When protected runtime configuration is set to `formal`, it selects only
   formal videos:

   ```text
   Session 1: is_test = false and session_pool = 1
   Session 2: is_test = false and session_pool = 2
   Session 3: is_test = false and session_pool = 3
   ```

   Formal mode requires exactly 40 eligible videos for the requested session.
   If a formal pool is incomplete, the app shows a configuration error and does
   not start the assessment. Formal mode never borrows videos from another
   `session_pool` and never uses `is_test = true` videos.

   To upload one local MP4 and upsert one matching `videos` row:

   ```bash
   npm run upload:video -- "/absolute/path/to/video-under-50mb.mp4" "video_001"
   ```

   To force a specific Storage filename:

   ```bash
   npm run upload:video -- "/absolute/path/to/video-under-50mb.mp4" "video_001" "video_001.mp4"
   ```

5. Start the app:

   ```bash
   npm run dev
   ```

## Atomic response and click audit data

PostgreSQL generates all `id` and `created_at` values. The browser never sends
them. A completed video is submitted through
`public.submit_video_response(text, integer, text, integer, boolean, bigint, bigint, boolean, jsonb, text)`.
The `SECURITY DEFINER` RPC is owned by the trusted migration role, has an empty
search path, and validates the matching `assessment_queue` row, completion
state, timing values, and contiguous click indexes. It inserts raw events before
the final response, so any validation, duplicate-response, or insert error rolls
back the whole transaction.

`responses` remains one final row per queued video:

- `answer` is boolean: `true` for `Lesion detected`, `false` for `No lesion detected`.
- `correct` is calculated in PostgreSQL from `videos.has_lesion`.
- `response_type` is derived from the final boolean answer.
- `response_time_ms` is the playback-start elapsed time for the first final-valid lesion click (`true`) or the final no-lesion action (`false`).
- `video_time_at_click` and `detection_latency_ms` summarize that first final-valid click for `true`; both are null for `false`.
- `no_response_latency_ms` is null for `true`; for `false`, it is the non-negative elapsed time from the actual video end to the final no-lesion action.
- `video_completed` must be `true`.

`lesion_detection_events` stores every raw `Lesion detected` click with the
participant/session/queue identity, ordered `click_index`, media time,
playback-start elapsed time, a snapshot of `lesion_onset_sec`, signed
`detection_latency_ms`, and finalization flags. Negative detection latency is
preserved when a click precedes the stored onset. For a final `yes`, every
submitted event has `final_valid = true` and `overridden = false`; formal
positive summaries use the first such event. For a final `no`, prior clicks are
retained for audit but have `final_valid = false` and `overridden = true`; the
response has null detection fields. A no-click negative response has no event
rows.

Anonymous clients receive `EXECUTE` on the RPC only. Direct table and identity
sequence privileges are revoked from `PUBLIC`, `anon`, and `authenticated`, so
the function is the sole boundary that can derive `correct`, timing, onset, and
finalization fields. They have no direct `INSERT`, `SELECT`, `UPDATE`, or
`DELETE` access to `responses`, `lesion_detection_events`, `assessment_queue`,
or `videos`. The browser receives only safe playback metadata from the
start/resume RPC, never `has_lesion` or `lesion_onset_sec`.

The participant workflow permits repeated lesion clicks only after playback
starts, including while playback is paused. Final controls are unavailable until
the actual HTML5 `ended` event. Then `Next video` is enabled only when at least
one click exists and submits `yes`; `No lesion detected` is always available and
submits `no`, overriding any prior clicks and clearing their visible markers.
Completed videos do not expose forward seek, replay, or redo controls.

Final controls lock while the RPC is in progress. If it fails, the exact pending
submission remains immutable and retryable without advancing the queue. A failed
positive retry retains all final-valid clicks. A failed overridden-negative retry
retains its raw overridden clicks even though the visible click count remains
cleared. The queue advances only after the RPC succeeds.

Refreshing or reopening the same browser with the same `participant_id` +
`session_number` reuses its stored access token and resumes from the first
persisted unanswered queue item returned by the start/resume RPC.
If all queued videos already have responses, the completion page is shown
immediately. A completed `participant_id` + `session_number` is terminal and
cannot be restarted; the same participant can still start a different session
number.

Each `participant_id` + `session_number` combination has its own persisted
`assessment_queue`, progress state, responses, and completion state. Session 1,
Session 2, and Session 3 do not share queue rows or response rows.

Video IDs are not hard-coded in the frontend. Pool selection is resolved in
PostgreSQL from `videos.is_test`, `videos.session_pool`, and protected runtime
configuration.

The anonymous browser client does not read `public.responses`,
`public.lesion_detection_events`, `public.assessment_queue`, or `public.videos`.
Resume recovery is handled by the database-side start/resume function, without
granting anonymous users direct table access.

The app never uses a local `/videos/...` path. Video URLs are generated at
runtime from the safe RPC metadata, then Supabase Storage `createSignedUrl`
creates temporary six-hour URLs for each returned `bucket/file_path`.
