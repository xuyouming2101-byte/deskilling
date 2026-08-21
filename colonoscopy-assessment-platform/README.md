# Colonoscopy Video Assessment MVP

Target assessment loop:

1. Collect `participant_id`, `session_number` (`1`, `2`, or `3`), and the coordinator-issued access code.
2. Call `start_or_resume_assessment(participant_id, session_number, access_code)`. PostgreSQL validates the active enrollment and authoritative mode, then owns pool selection, randomization, queue persistence, and resume order.
3. Ask a trusted Edge Function for the current video's URL. It calls the service-role-only `authorize_current_assessment_video` RPC and signs only the first unanswered private Storage object.
4. Show `Video X / queue length` and play the current video with task-specific, seek-free controls.
5. After playback starts, let the participant use `Lesion detected` repeatedly; each click separately records millisecond-precision media time and playback-start elapsed time.
6. After the actual HTML5 `ended` event, finalize exactly one response: `Next video` submits `yes` when at least one click exists, while `No lesion detected` submits `no` and overrides any prior clicks.
7. Submit the final classification and raw click audit atomically through the access-code-bound `submit_video_response` RPC, then advance only after a successful response.
8. Show a completion page after every queued video has a saved response.

Survey Creator and admin drag-and-drop editing are not included.

Session interval restrictions and AI exposure logic are not implemented yet;
this MVP only validates the technical multi-session workflow.

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. For a fresh project, run `supabase/schema.sql` in the Supabase SQL editor.
   For an existing project that already has the previous hardening migrations,
   apply `supabase/assessment_enrollment_hardening.sql` instead. Task 10 does
   not deploy this migration remotely.

3. Copy `.env.example` to `.env.local` and fill in:

   ```bash
   NEXT_PUBLIC_SUPABASE_URL=...
   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   ```

   The browser uses only the `NEXT_PUBLIC_...` values. Never expose
   `SUPABASE_SERVICE_ROLE_KEY` to browser code; it is reserved for trusted
   upload tooling and the current-video Edge Function.

4. Provision one enrollment per participant and session. Use a unique,
   high-entropy access code of at least 20 characters and give the plaintext
   code to the participant through the study's controlled channel. PostgreSQL
   stores only its SHA-256 digest:

   ```sql
   begin;

   delete from public.assessment_session_access
   where participant_id = 'P001'
     and session_number = 1;

   insert into public.assessment_enrollments (
     participant_id,
     session_number,
     access_code_digest,
     study_mode,
     active
   )
   values (
     'P001',
     1,
     extensions.digest('replace-with-a-unique-high-entropy-code', 'sha256'),
     'dev',
     true
   )
   on conflict (participant_id, session_number) do update
   set
     access_code_digest = excluded.access_code_digest,
     study_mode = excluded.study_mode,
     active = excluded.active,
     updated_at = now();

   commit;
   ```

   Deleting the old access binding is deliberate when provisioning or rotating
   a code; it does not delete the persisted queue or responses. A legacy queue
   without an active enrollment cannot resume. Once provisioned, it is reused
   only if its videos and contiguous order exactly match the eligible pool for
   the enrollment/runtime mode.

5. Confirm the private Supabase Storage objects exist and the `videos` table contains the eligible assessment videos:

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

6. Start the app:

   ```bash
   npm run dev
   ```

The Task 10 SQL contract intentionally removes anonymous Storage access and no
longer returns `bucket` or `file_path` from the browser queue RPC. Deploy it only
together with the companion Edge Function and frontend access-code integration;
those files are outside Task 10's database/docs scope.

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

Anonymous clients receive `EXECUTE` only on the enrollment-checked queue and
submission RPCs. Direct table and identity-sequence privileges are revoked from
`PUBLIC`, `anon`, and `authenticated`, so the functions are the only boundaries
that can create queues or derive `correct`, timing, onset, and finalization
fields. Browser roles have no direct access to `assessment_enrollments`,
`assessment_session_access`, `responses`, `lesion_detection_events`,
`assessment_queue`, or `videos`. The start/resume RPC returns queue identity and
progress only; it never returns Storage paths, `has_lesion`, or
`lesion_onset_sec`.

The access code must be at least 20 characters and match an active enrollment
whose `study_mode` equals protected runtime configuration. Missing, inactive,
wrong-code, and wrong-mode enrollments produce the same credential error.
`assessment_session_access` stores the matched digest and mode under a composite
foreign key, so a runtime-mode change cannot silently relabel an existing
session.

`authorize_current_assessment_video(text, integer, integer, text)` is granted
only to `service_role`. It returns one `bucket` and `file_path` only when the
requested order is the first unanswered queue item. Completed, previous,
skipped, future, wrong-code, and wrong-mode requests fail. The former global
Storage helper and anonymous `storage.objects` `SELECT` policy are removed, so
the publishable browser client cannot list, sign, or download private videos.

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

Refreshing or reopening the assessment with the same `participant_id` +
`session_number` + coordinator-issued access code resumes from the first
persisted unanswered queue item returned by the start/resume RPC. The code is
stable across tabs and devices; no browser-generated credential is used.
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
`public.lesion_detection_events`, `public.assessment_queue`, `public.videos`,
`public.assessment_enrollments`, or `public.assessment_session_access`. Resume
recovery is handled by the database-side start/resume function without granting
anonymous users direct table access.

The app never uses a local `/videos/...` path. Video URLs are generated at
runtime by a trusted Edge Function after the service-role-only current-video
RPC authorizes the first unanswered queue order. Supabase Storage then creates a
temporary signed URL for that single `bucket/file_path`; the browser cannot sign
the queue itself.
