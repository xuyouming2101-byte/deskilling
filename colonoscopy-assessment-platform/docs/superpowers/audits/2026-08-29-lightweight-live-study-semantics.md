# Phase 0A Lightweight Live Study Semantics

## Outcome

`LOCAL_SEMANTICS_SNAPSHOT_READY`

- Collection date: 2026-08-29
- Supabase project reference: `fgqpvlsogljpvyljjhpo`
- Raw local snapshot: `artifacts/local-study-snapshot/current-study-semantics.ndjson` (ignored by Git)
- Raw snapshot SHA-256: `108d677255bcad7a1fd130967c9861cfaebef813be7643d7398c6d4d9aefb427`
- Transaction guard observed: `transaction_read_only = on`
- `database_writes_performed: 0`

The snapshot was collected through an authenticated Supabase SQL channel inside an explicit `BEGIN TRANSACTION READ ONLY` transaction and ended with `ROLLBACK`. The committed audit contains schema facts, RPC signatures, configuration state, and grouped video-pool counts only. It contains no participant rows, response values, credentials, signed URLs, object paths, or per-video ground truth.

## Observed Tables

### `public.videos`

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | `bigint` | no | identity, `BY DEFAULT` |
| `video_id` | `text` | no | none |
| `file_path` | `text` | yes | none |
| `bucket` | `text` | yes | `'SSL'::text` |
| `has_lesion` | `boolean` | yes | none |
| `type` | `text` | yes | none |
| `ai_condition` | `text` | yes | none |
| `created_at` | `timestamptz` | yes | none |
| `lesion_onset_sec` | `double precision` | yes | none |
| `session_pool` | `integer` | yes | none |
| `is_test` | `boolean` | no | `false` |

The required LOCAL package metadata fields are present. `file_path`, `bucket`, `has_lesion`, `lesion_onset_sec`, and `session_pool` are nullable in the live schema, so package construction must validate required values rather than infer that they exist from the column definitions.

### `public.assessment_queue`

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | `bigint` | no | identity, `BY DEFAULT` |
| `participant_id` | `text` | no | none |
| `session_number` | `integer` | no | none |
| `video_id` | `text` | no | none |
| `video_order` | `integer` | no | none |
| `created_at` | `timestamptz` | no | `now()` |

### `public.responses`

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | `bigint` | no | identity, `BY DEFAULT` |
| `participant_id` | `text` | yes | none |
| `session_number` | `integer` | yes | none |
| `video_id` | `text` | yes | none |
| `video_order` | `integer` | yes | none |
| `answer` | `boolean` | yes | none |
| `correct` | `boolean` | yes | none |
| `response_time_ms` | `bigint` | yes | none |
| `created_at` | `timestamptz` | no | `now()` |
| `video_time_at_click` | `double precision` | yes | none |
| `detection_latency_ms` | `bigint` | yes | none |
| `response_type` | `text` | yes | none |
| `video_completed` | `boolean` | yes | none |
| `no_response_latency_ms` | `bigint` | yes | none |

Observed response check constraint:

- `no_response_latency_ms IS NULL OR no_response_latency_ms >= 0`

### `public.lesion_detection_events`

| Column | PostgreSQL type | Nullable | Default / identity |
| --- | --- | --- | --- |
| `id` | `bigint` | no | identity, `BY DEFAULT` |
| `participant_id` | `text` | no | none |
| `session_number` | `integer` | no | none |
| `video_id` | `text` | no | none |
| `video_order` | `integer` | no | none |
| `click_index` | `integer` | no | none |
| `video_time_at_click` | `double precision` | no | none |
| `response_time_ms` | `bigint` | no | none |
| `lesion_onset_sec` | `double precision` | yes | none |
| `detection_latency_ms` | `bigint` | yes | none |
| `overridden` | `boolean` | no | none |
| `final_valid` | `boolean` | no | none |
| `created_at` | `timestamptz` | no | `now()` |

Observed event check constraints:

- `click_index >= 1`
- `response_time_ms >= 0`
- `session_number BETWEEN 1 AND 3`
- `final_valid <> overridden`
- `video_order >= 1`
- `video_time_at_click >= 0`

### `public.assessment_runtime_config`

| Column | PostgreSQL type | Nullable | Default |
| --- | --- | --- | --- |
| `id` | `integer` | no | none |
| `study_mode` | `text` | no | none |
| `updated_at` | `timestamptz` | no | `now()` |

The current trusted runtime value is `study_mode = 'dev'`. Participant/browser input is not an authority for this setting.

## Observed Video Pool

The grouped, non-ground-truth pool summary contains one group:

| `is_test` | `session_pool` | Count |
| --- | --- | ---: |
| `true` | `NULL` | 20 |

No raw `has_lesion`, `lesion_onset_sec`, `file_path`, or video-level metadata values were copied into this committed audit.

## Observed RPC Contracts

| Function | Identity arguments | Result |
| --- | --- | --- |
| `authorize_current_assessment_video` | `p_participant_id text, p_session_number integer, p_video_order integer` | `TABLE(bucket text, file_path text)` |
| `get_next_video_order` | `p_participant_id text, p_session_number integer` | `integer` |
| `start_or_resume_assessment` | `p_participant_id text, p_session_number integer` | `TABLE(video_id text, video_order integer, next_video_order integer, queue_length integer, study_mode text)` |
| `submit_video_response` | `p_participant_id text, p_session_number integer, p_video_id text, p_video_order integer, p_answer boolean, p_response_time_ms bigint, p_no_response_latency_ms bigint, p_video_completed boolean, p_clicks jsonb` | `void` |

Only names, signatures, and result shapes were inspected. Function bodies, owners, grants, security-definer settings, and authorization behavior were not characterized in Phase 0A.

## Deliberately Unknown Until Phase 4

- Which repository migrations, if any, produced the current live state.
- Complete constraints, unique indexes, foreign keys, trigger behavior, and cross-table integrity.
- Function definitions, owners, grants, and effective execution privileges.
- Detailed RLS policies and their effective authenticated/anonymous behavior.
- Storage policies, deployed Edge Functions, and their deployed source/version correspondence.
- The existence or schema of access/enrollment tables not required for the LOCAL semantics snapshot.
- Whether current row-level video metadata are complete and internally consistent enough to seal a FORMAL LOCAL package.
- The approved coded participant roster required for a FORMAL LOCAL package.

This uncertainty does not block Phase 1-3 LOCAL development. It does block any live Supabase migration, synchronization deployment, or ONLINE Auth deployment until the exhaustive Phase 4 preflight, backup, restored-copy rehearsal, compatibility proof, and separate approval are complete.

## Phase Boundary

Phase 0A establishes enough field and RPC shape evidence to design and test the LOCAL contracts and SQLite model without changing the live backend. It does not authorize Phase 1, package production, Supabase schema changes, synchronization, ONLINE Auth, release-branch changes, or ECS deployment.
