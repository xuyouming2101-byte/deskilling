# AI-ON H264 playback copies

The operator supplied 40 H264 copies with unchanged duration and frame count.
Source MP4 files remain in `Test1/AION/videos/`; copies are in `Test1/AION/H264/`.
No re-encoding is performed by this migration.

Only `AION_T1_001` through `AION_T1_040` change `videos.file_path`, to
`Test1/AION/H264/01_ai_h264.mp4` through `40_ai_h264.mp4`. Stable video IDs preserve
existing queue order, responses, and event links. All 35 lesion windows remain
unchanged. AI-OFF metadata and media are not touched.

Apply `deploy/postgres/aion/20260924_h264_paths.sql` only after:

1. Exact 40-file name/count, per-file SHA256, codec, duration and frame-count checks.
2. Fresh PostgreSQL backup and independent restore rehearsal.
3. Deployment of the strict 01-40 H264 whitelist.

The transaction rejects an unexpected source mapping, updates exactly 40 paths,
and checks unchanged non-path metadata, research rows and functions. Reapplication
fails closed. The application continues using the same current-video authorization,
HMAC signatures, protected X-Accel-Redirect and Nginx internal location.

Acceptance includes P21's unchanged queue, current-video authorization, real HTTP
206 byte-range requests, and a browser playback reaching a genuine ended event.
Do not log in with an ordinary participant password or submit test research responses.
Rollback requires retaining both file sets and restoring only these paths from the
recorded backup; never restore the entire study database over newly collected data.
