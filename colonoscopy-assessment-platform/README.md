# Colonoscopy Video Assessment MVP

Minimal Next.js assessment loop:

1. Collect `participant_id` and `session_number` (`1`, `2`, or `3`).
2. Query `assessment_queue` for that participant/session.
3. Reuse the stored `video_order` when queue rows already exist.
4. If no queue exists, resolve that session's video pool from the current study mode, shuffle it once, and persist one `assessment_queue` row per video.
5. Call `get_next_video_order(participant_id, session_number)` and resume at that persisted `video_order`.
6. Create a signed URL for each private Supabase Storage object using its `bucket` and `file_path`.
7. Show `Video X / queue length`, play the current video, and ask `Yes` or `No` with SurveyJS Form Library.
8. Insert one row into the Supabase `responses` table after each submitted answer.
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

## responses table

The MVP writes:

PostgreSQL generates `id` and `created_at`; the app does not send either field.

- `participant_id`: entered before the assessment starts
- `session_number`: selected before the assessment starts, limited to `1`, `2`, or `3`
- `video_id`: current queue item from the persisted assessment queue
- `video_order`: persisted `assessment_queue.video_order`, `1` through the queue length
- `answer`: `yes` or `no`
- `correct`: calculated from `videos.has_lesion`
- `response_type`: `lesion_detected` or `no_lesion_detected`
- `response_time_ms`: playback-start to answer-click elapsed time in milliseconds
- `video_time_at_click`: HTML5 video `currentTime` at the first answer click, stored in seconds with millisecond precision
- `detection_latency_ms`: for `Lesion detected`, `(video_time_at_click - lesion_onset_sec) * 1000` when `videos.lesion_onset_sec` is available
- `video_completed`: whether the video had reached the end at the time of response

The insert payload does not send `created_at`; PostgreSQL fills it with the
table default `now()`.

`Lesion detected` is available after playback starts. `No lesion detected` is
available only after the video reaches the end. The first response click locks
the response so it cannot be changed.

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
