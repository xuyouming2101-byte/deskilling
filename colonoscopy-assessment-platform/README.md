# Colonoscopy Video Assessment MVP

Minimal Next.js assessment loop:

1. Collect `participant_id` and `session_number` (`1`, `2`, or `3`).
2. Query `assessment_queue` for that participant/session.
3. Reuse the stored `video_order` when queue rows already exist.
4. If no queue exists, resolve that session's video pool from the current study mode, shuffle it once, and persist one `assessment_queue` row per video.
5. Call `get_next_video_order(participant_id, session_number)` and resume at that persisted `video_order`.
6. Create a signed URL for each private Supabase Storage object using its `bucket` and `file_path`.
7. Show `Video X / queue length`, play the current video, and ask `Yes` or `No` with SurveyJS Form Library.
8. Task 3 will submit the final classification and raw lesion clicks through the atomic `submit_video_response` RPC.
9. Automatically advance to the next video, then show a completion page after every queued video has a saved response.

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
   NEXT_PUBLIC_STUDY_MODE=dev
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

   `NEXT_PUBLIC_STUDY_MODE=dev` is the current mode. It selects `videos` rows
   where `is_test = true`. Session 1, Session 2, and Session 3 may reuse the
   same current test pool, but each participant/session still creates its own
   independent randomized `assessment_queue`.

   `NEXT_PUBLIC_STUDY_MODE=formal` selects only formal videos:

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

Task 2 defines the database boundary; Task 3 moves the browser client to it.
PostgreSQL generates all `id` and `created_at` values. The browser never sends
them. A completed video is submitted through
`public.submit_video_response(text, integer, text, integer, boolean, bigint, bigint, boolean, jsonb)`.
The `SECURITY DEFINER` RPC is owned by the trusted migration role and validates the matching `assessment_queue` row,
completion state, timing values, and contiguous click indexes, then inserts raw
events before the final response. Any validation or unique-response error rolls
back both inserts.

`responses` remains one final row per queued video:

- `answer` is boolean: `true` for `Lesion detected`, `false` for `No lesion detected`.
- `correct` is calculated in PostgreSQL from `videos.has_lesion`.
- `response_type` is derived from the final boolean answer.
- `response_time_ms` is the playback-start elapsed time for the first valid lesion click (`true`) or the final no-lesion action (`false`).
- `video_time_at_click` and `detection_latency_ms` summarize the first valid click for `true`; both are null for `false`.
- `no_response_latency_ms` is null for `true`; for `false`, it is the non-negative elapsed time from the actual video end to the final no-lesion action.
- `video_completed` must be `true`.

`lesion_detection_events` stores every raw `Lesion detected` click with the
participant/session/queue identity, ordered `click_index`, media time,
playback-start elapsed time, a snapshot of `lesion_onset_sec`, signed
`detection_latency_ms`, and finalization flags. Negative detection latency is
preserved when a click precedes the stored onset. A final `true` marks every
submitted event `final_valid = true` and `overridden = false`. A final `false`
retains submitted clicks for audit but marks them `final_valid = false` and
`overridden = true`; a no-click negative response has no event rows.

Anonymous clients receive `EXECUTE` on the RPC only. Direct table and identity
sequence privileges are revoked from `PUBLIC`, `anon`, and `authenticated`, so
the function is the sole boundary that can derive `correct`, timing, onset, and
finalization fields. They have no direct `INSERT`, `SELECT`, `UPDATE`, or
`DELETE` access to either `responses` or `lesion_detection_events`.

The current browser client still has the pre-Task 3 direct-insert implementation.
It is intentionally not compatible with this Task 2 database hardening until
Task 3 switches it to `submit_video_response`.

The participant workflow permits repeated lesion clicks only after playback
starts. Final classification is available only after the actual HTML5 `ended`
event; completed videos do not expose forward seek, replay, or redo controls.

Refreshing or reopening the same `participant_id` + `session_number` resumes
from the first persisted queue item returned by the `get_next_video_order` RPC.
If all queued videos already have responses, the completion page is shown
immediately. A completed `participant_id` + `session_number` is terminal and
cannot be restarted; the same participant can still start a different session
number.

Each `participant_id` + `session_number` combination has its own persisted
`assessment_queue`, progress state, responses, and completion state. Session 1,
Session 2, and Session 3 do not share queue rows or response rows.

Video IDs are not hard-coded in the frontend. Pool selection is resolved in the
data layer from `videos.is_test`, `videos.session_pool`, and
`NEXT_PUBLIC_STUDY_MODE`.

The anonymous browser client does not read `public.responses`. Resume recovery
is handled by the database-side `get_next_video_order` function so `responses`
can keep insert-only RLS for anonymous users.

The app never uses a local `/videos/...` path. Video URLs are generated at
runtime by querying `videos`, then calling Supabase Storage `createSignedUrl`
on each row's `bucket/file_path`.
