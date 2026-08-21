# Multi-Lesion Click Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Require full video playback, collect repeated lesion clicks, and atomically save one mutually exclusive final response plus auditable raw click events.

**Architecture:** Pure TypeScript functions define timing, click accumulation, action availability, and final submission semantics. React components provide a seek-free player and task-specific controls. A trusted Supabase SECURITY DEFINER RPC validates and inserts the final response and raw events in one PostgreSQL transaction; direct response and event writes are revoked.

**Tech Stack:** Next.js 16.3, React 19, TypeScript 5.8, SurveyJS Form Library 2.5, Supabase JS 2.55, PostgreSQL 17, Node.js 22 built-in test runner.

**Spec:** docs/superpowers/specs/2026-08-21-multi-lesion-click-audit-design.md

## Global Constraints

- Preserve persistent randomized assessment_queue behavior and get_next_video_order resume behavior.
- Preserve private Supabase Storage and signed URL loading.
- Preserve dynamic queue length and independent Session 1, 2, and 3 state.
- Never send generated id or created_at values.
- Do not expose SELECT access to responses or lesion_detection_events.
- Do not alter or delete the existing 47 response rows.
- Final yes and no classifications are mutually exclusive.
- Final no stores null response detection time and null detection latency.
- Preserve negative lesion detection latency.
- Do not add replay, redo, Survey Creator, or administration tools.

---

### Task 1: Add a testable response-domain model

**Files:**
- Create: lib/lesionResponse.test.ts
- Create: lib/lesionResponse.ts
- Modify: lib/assessmentTypes.ts
- Modify: package.json
- Modify: tsconfig.json

**Interfaces:**
- Produces: createLesionDetectionClick(args): LesionDetectionClick
- Produces: getResponseActionState(args): { canDetect: boolean; canReportNoLesion: boolean; canGoNext: boolean }
- Produces: buildVideoSubmission(args): VideoSubmission

- [ ] **Step 1: Add the Node.js TypeScript test command**

Modify package.json:

~~~json
{
  "scripts": {
    "test": "node --test lib/*.test.ts"
  }
}
~~~

Add this compiler option to tsconfig.json because tests import TypeScript files directly under Node.js 22:

~~~json
{
  "compilerOptions": {
    "allowImportingTsExtensions": true
  }
}
~~~

- [ ] **Step 2: Write the failing domain tests**

Create lib/lesionResponse.test.ts:

~~~ts
import assert from "node:assert/strict";
import test from "node:test";
import {
  buildVideoSubmission,
  createLesionDetectionClick,
  getResponseActionState
} from "./lesionResponse.ts";

const identity = {
  participant_id: "P001",
  session_number: 1,
  video_id: "video_001",
  video_order: 1
};

test("records repeated clicks with independent media and performance timing", () => {
  const first = createLesionDetectionClick({
    clickIndex: 1,
    videoTimeSec: 2.1254,
    nowMs: 5_100.4,
    playbackStartedAtMs: 1_000,
    lesionOnsetSec: 3
  });
  const second = createLesionDetectionClick({
    clickIndex: 2,
    videoTimeSec: 4.5,
    nowMs: 7_000,
    playbackStartedAtMs: 1_000,
    lesionOnsetSec: 3
  });

  assert.deepEqual(first, {
    click_index: 1,
    video_time_at_click: 2.125,
    response_time_ms: 4_100,
    detection_latency_ms: -875
  });
  assert.equal(second.click_index, 2);
  assert.equal(second.detection_latency_ms, 1_500);
});

test("keeps detection latency null when lesion onset is unavailable", () => {
  const click = createLesionDetectionClick({
    clickIndex: 1,
    videoTimeSec: 8,
    nowMs: 10_000,
    playbackStartedAtMs: 1_000,
    lesionOnsetSec: null
  });

  assert.equal(click.detection_latency_ms, null);
});

test("enables final actions only after the video ends", () => {
  assert.deepEqual(
    getResponseActionState({
      videoStarted: true,
      videoEnded: false,
      clickCount: 2,
      locked: false
    }),
    { canDetect: true, canReportNoLesion: false, canGoNext: false }
  );
  assert.deepEqual(
    getResponseActionState({
      videoStarted: true,
      videoEnded: true,
      clickCount: 2,
      locked: false
    }),
    { canDetect: false, canReportNoLesion: true, canGoNext: true }
  );
  assert.deepEqual(
    getResponseActionState({
      videoStarted: true,
      videoEnded: true,
      clickCount: 0,
      locked: false
    }),
    { canDetect: false, canReportNoLesion: true, canGoNext: false }
  );
});

test("positive summary uses the first valid lesion click", () => {
  const submission = buildVideoSubmission({
    ...identity,
    finalClassification: "yes",
    clicks: [
      {
        click_index: 1,
        video_time_at_click: 2.125,
        response_time_ms: 4_100,
        detection_latency_ms: -875
      },
      {
        click_index: 2,
        video_time_at_click: 4.5,
        response_time_ms: 6_000,
        detection_latency_ms: 1_500
      }
    ],
    nowMs: 8_000,
    playbackStartedAtMs: 1_000,
    videoEndedAtMs: 7_500
  });

  assert.equal(submission.final_answer, true);
  assert.equal(submission.response_time_ms, 4_100);
  assert.equal(submission.summary_video_time_at_click, 2.125);
  assert.equal(submission.summary_detection_latency_ms, -875);
  assert.equal(submission.no_response_latency_ms, null);
  assert.equal(submission.clicks.length, 2);
});

test("negative summary has no detection time and preserves overridden raw clicks", () => {
  const rawClick = {
    click_index: 1,
    video_time_at_click: 2.125,
    response_time_ms: 4_100,
    detection_latency_ms: -875
  };
  const submission = buildVideoSubmission({
    ...identity,
    finalClassification: "no",
    clicks: [rawClick],
    nowMs: 9_125.4,
    playbackStartedAtMs: 1_000,
    videoEndedAtMs: 8_000
  });

  assert.equal(submission.final_answer, false);
  assert.equal(submission.response_time_ms, 8_125);
  assert.equal(submission.summary_video_time_at_click, null);
  assert.equal(submission.summary_detection_latency_ms, null);
  assert.equal(submission.no_response_latency_ms, 1_125);
  assert.deepEqual(submission.clicks, [rawClick]);
});

test("rejects a positive final classification without lesion clicks", () => {
  assert.throws(
    () =>
      buildVideoSubmission({
        ...identity,
        finalClassification: "yes",
        clicks: [],
        nowMs: 9_000,
        playbackStartedAtMs: 1_000,
        videoEndedAtMs: 8_000
      }),
    /requires at least one lesion click/
  );
});
~~~

The mutations these tests catch are: clamping negative latency, reusing the latest click instead of the first, assigning an end time to a negative response, enabling Next without a click, and discarding overridden raw clicks.

- [ ] **Step 3: Run the tests and verify RED**

Run:

~~~bash
npm test
~~~

Expected: FAIL with ERR_MODULE_NOT_FOUND for lib/lesionResponse.ts.

- [ ] **Step 4: Add the domain types and minimal implementation**

Replace the one-shot ResponseInsert type in lib/assessmentTypes.ts with:

~~~ts
export type LesionAnswer = "yes" | "no";

export type LesionDetectionClick = {
  click_index: number;
  video_time_at_click: number;
  response_time_ms: number;
  detection_latency_ms: number | null;
};

export type VideoSubmission = {
  participant_id: string;
  session_number: number;
  video_id: string;
  video_order: number;
  final_answer: boolean;
  response_time_ms: number;
  summary_video_time_at_click: number | null;
  summary_detection_latency_ms: number | null;
  no_response_latency_ms: number | null;
  video_completed: true;
  clicks: readonly LesionDetectionClick[];
};
~~~

Create lib/lesionResponse.ts:

~~~ts
import type {
  LesionAnswer,
  LesionDetectionClick,
  VideoSubmission
} from "./assessmentTypes.ts";

type ClickArgs = {
  clickIndex: number;
  videoTimeSec: number;
  nowMs: number;
  playbackStartedAtMs: number;
  lesionOnsetSec: number | null;
};

type ActionStateArgs = {
  videoStarted: boolean;
  videoEnded: boolean;
  clickCount: number;
  locked: boolean;
};

type BuildSubmissionArgs = {
  participant_id: string;
  session_number: number;
  video_id: string;
  video_order: number;
  finalClassification: LesionAnswer;
  clicks: readonly LesionDetectionClick[];
  nowMs: number;
  playbackStartedAtMs: number;
  videoEndedAtMs: number;
};

const roundVideoSeconds = (value: number) =>
  Math.round(Math.max(0, value) * 1000) / 1000;

export function createLesionDetectionClick(
  args: ClickArgs
): LesionDetectionClick {
  const videoTimeAtClick = roundVideoSeconds(args.videoTimeSec);

  return {
    click_index: args.clickIndex,
    video_time_at_click: videoTimeAtClick,
    response_time_ms: Math.max(
      0,
      Math.round(args.nowMs - args.playbackStartedAtMs)
    ),
    detection_latency_ms:
      args.lesionOnsetSec === null
        ? null
        : Math.round((videoTimeAtClick - args.lesionOnsetSec) * 1000)
  };
}

export function getResponseActionState(args: ActionStateArgs) {
  if (!args.videoStarted || args.locked) {
    return {
      canDetect: false,
      canReportNoLesion: false,
      canGoNext: false
    };
  }

  return {
    canDetect: !args.videoEnded,
    canReportNoLesion: args.videoEnded,
    canGoNext: args.videoEnded && args.clickCount > 0
  };
}

export function buildVideoSubmission(
  args: BuildSubmissionArgs
): VideoSubmission {
  if (!Number.isFinite(args.videoEndedAtMs)) {
    throw new Error("A completed video requires an ended event timestamp.");
  }

  const firstClick = args.clicks[0] ?? null;

  if (args.finalClassification === "yes" && firstClick === null) {
    throw new Error("A positive response requires at least one lesion click.");
  }

  const isPositive = args.finalClassification === "yes";

  return {
    participant_id: args.participant_id,
    session_number: args.session_number,
    video_id: args.video_id,
    video_order: args.video_order,
    final_answer: isPositive,
    response_time_ms: isPositive
      ? firstClick!.response_time_ms
      : Math.max(0, Math.round(args.nowMs - args.playbackStartedAtMs)),
    summary_video_time_at_click: isPositive
      ? firstClick!.video_time_at_click
      : null,
    summary_detection_latency_ms: isPositive
      ? firstClick!.detection_latency_ms
      : null,
    no_response_latency_ms: isPositive
      ? null
      : Math.max(0, Math.round(args.nowMs - args.videoEndedAtMs)),
    video_completed: true,
    clicks: args.clicks.map((click) => ({ ...click }))
  };
}
~~~

- [ ] **Step 5: Run tests and typecheck to verify GREEN**

Run:

~~~bash
npm test
npm run typecheck
~~~

Expected: all domain tests PASS and TypeScript exits 0.

- [ ] **Step 6: Commit**

~~~bash
git add colonoscopy-assessment-platform/package.json colonoscopy-assessment-platform/tsconfig.json colonoscopy-assessment-platform/lib/assessmentTypes.ts colonoscopy-assessment-platform/lib/lesionResponse.ts colonoscopy-assessment-platform/lib/lesionResponse.test.ts
git commit -m "test: define multi-click response semantics"
~~~

---

### Task 2: Add the audit table and atomic Supabase RPC

**Files:**
- Create: supabase/multi_lesion_click_audit.sql
- Modify: supabase/schema.sql
- Modify: README.md

**Interfaces:**
- Produces: public.lesion_detection_events
- Produces: responses.no_response_latency_ms
- Produces: public.submit_video_response(text, integer, text, integer, boolean, bigint, bigint, boolean, jsonb)
- Preserves: public.get_next_video_order(text, integer)

- [ ] **Step 1: Record the failing schema assertions**

Run this read-only query through Supabase execute_sql:

~~~sql
select
  to_regclass('public.lesion_detection_events') is not null as events_table_exists,
  exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'responses'
      and column_name = 'no_response_latency_ms'
  ) as no_latency_column_exists,
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'submit_video_response'
  ) as submit_rpc_exists;
~~~

Expected before migration: all three values are false.

- [ ] **Step 2: Write the additive migration**

Create supabase/multi_lesion_click_audit.sql. It must:

1. Add nullable responses.no_response_latency_ms bigint with a non-negative check.
2. Add a unique index on videos.video_id after asserting there are no duplicates.
3. Create lesion_detection_events with identity id, queue identity columns, click timing, onset snapshot, signed latency, overridden, final_valid, created_at, and the constraints from the design spec.
4. Enable RLS.
5. Revoke all direct table and identity-sequence privileges from PUBLIC, anon, and authenticated; do not create response or event policies for anon.
6. Drop the old anonymous response and event insert policies while retaining RLS on both tables.
7. Create the trusted SECURITY DEFINER submit_video_response function with search_path = '' and schema-qualified database objects.
8. Revoke function execution from PUBLIC and authenticated, then grant it to anon only.

Use this exact migration:

~~~sql
do $$
begin
  if exists (
    select 1
    from public.videos
    group by video_id
    having count(*) > 1
  ) then
    raise exception 'videos.video_id contains duplicates';
  end if;
end
$$;

create unique index if not exists videos_video_id_key
  on public.videos (video_id);

alter table public.responses
  add column if not exists no_response_latency_ms bigint;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'responses_no_response_latency_nonnegative'
      and conrelid = 'public.responses'::regclass
  ) then
    alter table public.responses
      add constraint responses_no_response_latency_nonnegative
      check (
        no_response_latency_ms is null
        or no_response_latency_ms >= 0
      );
  end if;
end
$$;

create table if not exists public.lesion_detection_events (
  id bigint generated by default as identity primary key,
  participant_id text not null,
  session_number integer not null
    check (session_number between 1 and 3),
  video_id text not null references public.videos (video_id),
  video_order integer not null check (video_order >= 1),
  click_index integer not null check (click_index >= 1),
  video_time_at_click double precision not null
    check (video_time_at_click >= 0),
  response_time_ms bigint not null check (response_time_ms >= 0),
  lesion_onset_sec double precision,
  detection_latency_ms bigint,
  overridden boolean not null,
  final_valid boolean not null,
  created_at timestamptz not null default now(),
  constraint lesion_detection_events_unique_click
    unique (participant_id, session_number, video_id, click_index),
  constraint lesion_detection_events_validity_pair
    check (final_valid <> overridden)
);

create index if not exists lesion_detection_events_audit_order_idx
  on public.lesion_detection_events (
    participant_id,
    session_number,
    video_order,
    click_index
  );

create index if not exists lesion_detection_events_final_analysis_idx
  on public.lesion_detection_events (
    video_id,
    detection_latency_ms
  )
  where final_valid = true;

alter table public.lesion_detection_events enable row level security;

revoke all on table public.lesion_detection_events
  from public, anon, authenticated;
revoke all on sequence public.lesion_detection_events_id_seq
  from public, anon, authenticated;
revoke all on table public.responses
  from public, anon, authenticated;
revoke all on sequence public.responses_id_seq
  from public, anon, authenticated;

drop policy if exists "Allow anonymous lesion event inserts"
  on public.lesion_detection_events;

drop policy if exists "Allow anonymous response inserts"
  on public.responses;

create or replace function public.submit_video_response(
  p_participant_id text,
  p_session_number integer,
  p_video_id text,
  p_video_order integer,
  p_answer boolean,
  p_response_time_ms bigint,
  p_no_response_latency_ms bigint,
  p_video_completed boolean,
  p_clicks jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  video_has_lesion boolean;
  video_lesion_onset_sec double precision;
  click_count integer;
  distinct_click_count integer;
  minimum_click_index integer;
  maximum_click_index integer;
  first_video_time double precision;
  first_response_time_ms bigint;
  first_detection_latency_ms bigint;
begin
  if length(trim(coalesce(p_participant_id, ''))) = 0 then
    raise exception 'participant_id is required';
  end if;

  if p_session_number is null
     or p_session_number not between 1 and 3 then
    raise exception 'session_number must be 1, 2, or 3';
  end if;

  if p_video_order is null or p_video_order < 1 then
    raise exception 'video_order must be positive';
  end if;

  if p_answer is null then
    raise exception 'answer is required';
  end if;

  if p_video_completed is distinct from true then
    raise exception 'video must be completed before submission';
  end if;

  if p_response_time_ms is null or p_response_time_ms < 0 then
    raise exception 'response_time_ms must be non-negative';
  end if;

  if p_answer is true and p_no_response_latency_ms is not null then
    raise exception 'positive responses cannot have no_response_latency_ms';
  end if;

  if p_answer is false and (
    p_no_response_latency_ms is null
    or p_no_response_latency_ms < 0
  ) then
    raise exception 'negative responses require no_response_latency_ms';
  end if;

  if p_clicks is null or jsonb_typeof(p_clicks) <> 'array' then
    raise exception 'p_clicks must be a JSON array';
  end if;

  select v.has_lesion, v.lesion_onset_sec
  into video_has_lesion, video_lesion_onset_sec
  from public.assessment_queue q
  join public.videos v on v.video_id = q.video_id
  where q.participant_id = p_participant_id
    and q.session_number = p_session_number
    and q.video_id = p_video_id
    and q.video_order = p_video_order;

  if not found then
    raise exception 'assessment queue item does not exist';
  end if;

  if video_has_lesion is null then
    raise exception 'videos.has_lesion is required';
  end if;

  select
    count(*)::integer,
    count(distinct click_row.click_index)::integer,
    min(click_row.click_index),
    max(click_row.click_index)
  into
    click_count,
    distinct_click_count,
    minimum_click_index,
    maximum_click_index
  from jsonb_to_recordset(p_clicks) as click_row(
    click_index integer,
    video_time_at_click double precision,
    response_time_ms bigint
  );

  if p_answer is true and click_count = 0 then
    raise exception 'positive responses require at least one lesion click';
  end if;

  if click_count > 0 and (
    distinct_click_count <> click_count
    or minimum_click_index <> 1
    or maximum_click_index <> click_count
  ) then
    raise exception 'click indexes must be unique and contiguous from 1';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_clicks) as click_row(
      click_index integer,
      video_time_at_click double precision,
      response_time_ms bigint
    )
    where click_row.click_index is null
      or click_row.video_time_at_click is null
      or click_row.video_time_at_click < 0
      or click_row.response_time_ms is null
      or click_row.response_time_ms < 0
  ) then
    raise exception 'click timing values are invalid';
  end if;

  if p_answer is true then
    select
      round(click_row.video_time_at_click::numeric, 3)::double precision,
      click_row.response_time_ms,
      case
        when video_lesion_onset_sec is null then null
        else round(
          (
            round(click_row.video_time_at_click::numeric, 3)::double precision
            - video_lesion_onset_sec
          ) * 1000
        )::bigint
      end
    into
      first_video_time,
      first_response_time_ms,
      first_detection_latency_ms
    from jsonb_to_recordset(p_clicks) as click_row(
      click_index integer,
      video_time_at_click double precision,
      response_time_ms bigint
    )
    order by click_row.click_index
    limit 1;
  end if;

  insert into public.lesion_detection_events (
    participant_id,
    session_number,
    video_id,
    video_order,
    click_index,
    video_time_at_click,
    response_time_ms,
    lesion_onset_sec,
    detection_latency_ms,
    overridden,
    final_valid
  )
  select
    p_participant_id,
    p_session_number,
    p_video_id,
    p_video_order,
    click_row.click_index,
    round(click_row.video_time_at_click::numeric, 3)::double precision,
    click_row.response_time_ms,
    video_lesion_onset_sec,
    case
      when video_lesion_onset_sec is null then null
      else round(
        (
          round(click_row.video_time_at_click::numeric, 3)::double precision
          - video_lesion_onset_sec
        ) * 1000
      )::bigint
    end,
    not p_answer,
    p_answer
  from jsonb_to_recordset(p_clicks) as click_row(
    click_index integer,
    video_time_at_click double precision,
    response_time_ms bigint
  );

  insert into public.responses (
    participant_id,
    session_number,
    video_id,
    video_order,
    answer,
    correct,
    response_time_ms,
    video_time_at_click,
    detection_latency_ms,
    response_type,
    video_completed,
    no_response_latency_ms
  )
  values (
    p_participant_id,
    p_session_number,
    p_video_id,
    p_video_order,
    p_answer,
    video_has_lesion = p_answer,
    case
      when p_answer then first_response_time_ms
      else p_response_time_ms
    end,
    case when p_answer then first_video_time else null end,
    case when p_answer then first_detection_latency_ms else null end,
    case
      when p_answer then 'lesion_detected'
      else 'no_lesion_detected'
    end,
    true,
    case when p_answer then null else p_no_response_latency_ms end
  );
end
$$;

revoke all on function public.submit_video_response(
  text,
  integer,
  text,
  integer,
  boolean,
  bigint,
  bigint,
  boolean,
  jsonb
) from public;

revoke all on function public.submit_video_response(
  text,
  integer,
  text,
  integer,
  boolean,
  bigint,
  bigint,
  boolean,
  jsonb
) from authenticated;

grant execute on function public.submit_video_response(
  text,
  integer,
  text,
  integer,
  boolean,
  bigint,
  bigint,
  boolean,
  jsonb
) to anon;
~~~

The function body must parse p_clicks with:

~~~sql
from jsonb_to_recordset(p_clicks) as click_row(
  click_index integer,
  video_time_at_click double precision,
  response_time_ms bigint
)
~~~

It must reject malformed JSON, non-contiguous click indexes, invalid timing values, positive answers without clicks, negative no-response latency, and queue mismatches. Read has_lesion and lesion_onset_sec from public.videos. For each event compute:

~~~sql
case
  when video_lesion_onset_sec is null then null
  else round(
    (click_row.video_time_at_click - video_lesion_onset_sec) * 1000
  )::bigint
end
~~~

For p_answer = true, insert all events as overridden = false and final_valid = true, then insert the response summary using click_index = 1. For p_answer = false, insert all events as overridden = true and final_valid = false, then insert response video_time_at_click and detection_latency_ms as null. Insert the response last so any unique-response error rolls back the event inserts.

- [ ] **Step 3: Mirror the additive objects in the bootstrap schema**

Update supabase/schema.sql so a fresh environment uses the live boolean responses.answer type, includes no_response_latency_ms, creates lesion_detection_events, and defines the same RPC and RLS policies. Do not add data migrations or modify existing response rows.

- [ ] **Step 4: Apply the migration to the connected project**

Use Supabase apply_migration with:

~~~text
project_id: fgqpvlsogljpvyljjhpo
name: multi_lesion_click_audit
query: exact contents of supabase/multi_lesion_click_audit.sql
~~~

Expected: migration succeeds once without changing the immediately captured response snapshot. Do not hard-code a permanent response count.

- [ ] **Step 5: Verify schema, transaction behavior, and access control**

Capture the response count and maximum response id immediately before applying the migration, then compare that snapshot immediately after application. Verify direct anonymous access before the transaction test:

~~~sql
select
  has_table_privilege('anon', 'public.responses', 'INSERT') as responses_insert,
  has_table_privilege('anon', 'public.responses', 'SELECT') as responses_select,
  has_table_privilege('anon', 'public.lesion_detection_events', 'INSERT') as events_insert,
  has_table_privilege('anon', 'public.lesion_detection_events', 'SELECT') as events_select;
~~~

Expected: all four values are false. Then run a transaction-backed RPC test using a reserved participant ID:

~~~sql
begin;

insert into public.assessment_queue (
  participant_id, session_number, video_id, video_order
)
select
  '__codex_multi_click_rpc_test__',
  1,
  video_id,
  row_number() over (order by video_id)
from public.videos
where is_test = true
order by video_id
limit 3;

set local role anon;

select public.submit_video_response(
  '__codex_multi_click_rpc_test__',
  1,
  (
    select video_id
    from public.assessment_queue
    where participant_id = '__codex_multi_click_rpc_test__'
      and video_order = 1
  ),
  1,
  true,
  4100,
  null,
  true,
  '[{"click_index":1,"video_time_at_click":2.125,"response_time_ms":4100},{"click_index":2,"video_time_at_click":4.5,"response_time_ms":6000}]'::jsonb
);

select public.submit_video_response(
  '__codex_multi_click_rpc_test__',
  1,
  (
    select video_id
    from public.assessment_queue
    where participant_id = '__codex_multi_click_rpc_test__'
      and video_order = 2
  ),
  2,
  false,
  8125,
  1125,
  true,
  '[{"click_index":1,"video_time_at_click":2.125,"response_time_ms":4100}]'::jsonb
);

select public.submit_video_response(
  '__codex_multi_click_rpc_test__',
  1,
  (
    select video_id
    from public.assessment_queue
    where participant_id = '__codex_multi_click_rpc_test__'
      and video_order = 3
  ),
  3,
  false,
  9000,
  1000,
  true,
  '[]'::jsonb
);

do $$
begin
  begin
    perform public.submit_video_response(
      '__codex_multi_click_rpc_test__',
      1,
      (
        select video_id
        from public.assessment_queue
        where participant_id = '__codex_multi_click_rpc_test__'
          and video_order = 3
      ),
      3,
      true,
      4100,
      null,
      true,
      '[{"click_index":1,"video_time_at_click":2.125,"response_time_ms":4100}]'::jsonb
    );
    raise exception 'expected responses_unique_trial violation';
  exception
    when unique_violation then null;
  end;
end
$$;

reset role;

select answer, video_time_at_click, detection_latency_ms,
       no_response_latency_ms, video_completed
from public.responses
where participant_id = '__codex_multi_click_rpc_test__'
order by video_order;

select video_order, click_index, overridden, final_valid
from public.lesion_detection_events
where participant_id = '__codex_multi_click_rpc_test__'
order by video_order, click_index;

select q.video_order, count(e.id)::integer as event_count
from public.assessment_queue q
left join public.lesion_detection_events e
  on e.participant_id = q.participant_id
  and e.session_number = q.session_number
  and e.video_id = q.video_id
where q.participant_id = '__codex_multi_click_rpc_test__'
  and q.session_number = 1
group by q.video_order
order by q.video_order;

rollback;
~~~

Expected:

- Positive response uses answer = true and first-click summary.
- Negative response uses answer = false, null detection fields, and no_response_latency_ms = 1125.
- Positive events are final_valid; negative event is overridden.
- Video 3 has a final no response with no events before the duplicate attempt.
- Rollback leaves no test rows.
- Anonymous direct INSERT and SELECT privileges are false for both tables; a REST insert attempt must be rejected.
- The anon RPC calls succeed despite the direct-table revocations.
- The video 3 duplicate yes call runs inside a PL/pgSQL exception subtransaction, reaches `responses_unique_trial`, and catches only `unique_violation`; the outer transaction remains usable and video 3 still has zero events afterward.

Run Supabase security and performance advisors and resolve any finding caused by this migration.

- [ ] **Step 6: Commit**

~~~bash
git add colonoscopy-assessment-platform/supabase/multi_lesion_click_audit.sql colonoscopy-assessment-platform/supabase/schema.sql colonoscopy-assessment-platform/README.md
git commit -m "feat: add atomic lesion click audit storage"
~~~

---

### Task 3: Replace direct response inserts with the RPC client

**Files:**
- Modify: lib/supabaseClient.ts
- Modify: lib/assessmentTypes.ts
- Modify: lib/lesionResponse.test.ts

**Interfaces:**
- Consumes: VideoSubmission
- Produces: submitVideoResponse(submission: VideoSubmission): Promise<PostgrestResponse>
- Removes: insertResponse(response: ResponseInsert)

- [ ] **Step 1: Add a failing RPC parameter test**

Add buildSubmissionRpcParams to the imports in lib/lesionResponse.test.ts and assert a literal mapping:

~~~ts
test("maps a final submission to the exact RPC parameter contract", () => {
  const params = buildSubmissionRpcParams({
    ...identity,
    final_answer: false,
    response_time_ms: 8_125,
    summary_video_time_at_click: null,
    summary_detection_latency_ms: null,
    no_response_latency_ms: 1_125,
    video_completed: true,
    clicks: [
      {
        click_index: 1,
        video_time_at_click: 2.125,
        response_time_ms: 4_100,
        detection_latency_ms: -875
      }
    ]
  });

  assert.deepEqual(params, {
    p_participant_id: "P001",
    p_session_number: 1,
    p_video_id: "video_001",
    p_video_order: 1,
    p_answer: false,
    p_response_time_ms: 8_125,
    p_no_response_latency_ms: 1_125,
    p_video_completed: true,
    p_clicks: [
      {
        click_index: 1,
        video_time_at_click: 2.125,
        response_time_ms: 4_100
      }
    ]
  });
});
~~~

- [ ] **Step 2: Run the test and verify RED**

Run npm test. Expected: FAIL because buildSubmissionRpcParams is missing.

- [ ] **Step 3: Implement the exact mapping and RPC call**

Add buildSubmissionRpcParams to lib/lesionResponse.ts. It omits client-computed detection_latency_ms from p_clicks because PostgreSQL recomputes latency from the stored video onset snapshot:

~~~ts
export function buildSubmissionRpcParams(submission: VideoSubmission) {
  return {
    p_participant_id: submission.participant_id,
    p_session_number: submission.session_number,
    p_video_id: submission.video_id,
    p_video_order: submission.video_order,
    p_answer: submission.final_answer,
    p_response_time_ms: submission.response_time_ms,
    p_no_response_latency_ms: submission.no_response_latency_ms,
    p_video_completed: submission.video_completed,
    p_clicks: submission.clicks.map((click) => ({
      click_index: click.click_index,
      video_time_at_click: click.video_time_at_click,
      response_time_ms: click.response_time_ms
    }))
  };
}
~~~

Replace insertResponse in lib/supabaseClient.ts with:

~~~ts
export async function submitVideoResponse(submission: VideoSubmission) {
  const supabase = getSupabaseClient();
  if (!supabase) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
    );
  }

  const params = buildSubmissionRpcParams(submission);
  console.log("submit_video_response payload", params);
  const result = await supabase.rpc("submit_video_response", params);
  console.log("submit_video_response result", result);

  if (result.error) {
    throw new Error(result.error.message);
  }

  return result;
}
~~~

Remove direct response table insertion, forbidden-column checks, and stale ResponseInsert references.

- [ ] **Step 4: Verify GREEN**

Run:

~~~bash
npm test
npm run typecheck
~~~

Expected: all tests PASS and no ResponseInsert or insertResponse references remain under app, components, or lib.

- [ ] **Step 5: Commit**

~~~bash
git add colonoscopy-assessment-platform/lib/assessmentTypes.ts colonoscopy-assessment-platform/lib/lesionResponse.ts colonoscopy-assessment-platform/lib/lesionResponse.test.ts colonoscopy-assessment-platform/lib/supabaseClient.ts
git commit -m "feat: submit video responses through atomic RPC"
~~~

---

### Task 4: Build a seek-free clinical video player

**Files:**
- Create: components/AssessmentVideoPlayer.tsx
- Modify: app/globals.css

**Interfaces:**
- Produces: forwarded HTMLVideoElement ref for millisecond media-time capture
- Produces: onPlaybackStarted(), onEnded(endedAtMs), onPlaybackStateChange()
- Consumes: signedUrl, videoId, locked, videoError handler

- [ ] **Step 1: Extend the domain action test for locked and unstarted states**

Add literal assertions that all actions are false before playback and after locking. Run npm test and verify the new expectations fail until getResponseActionState handles both branches.

- [ ] **Step 2: Implement the minimal domain branch and verify GREEN**

Update getResponseActionState, then run npm test.

- [ ] **Step 3: Implement AssessmentVideoPlayer**

Use React forwardRef. Remove the native controls attribute. Render:

- the video element;
- a Play/Pause icon button;
- a Mute/Unmute icon button;
- a Fullscreen icon button;
- a non-interactive progress element with current time and duration;
- no seek slider and no replay action.

The component must:

- set playbackStarted only on the first play event;
- allow pause/resume before end;
- call onEnded(performance.now()) only from the real ended event;
- disable Play/Pause after ended or while locked;
- never assign video.currentTime;
- expose tooltips and accessible labels for icon buttons;
- display stable dimensions on desktop and mobile.

- [ ] **Step 4: Style the custom player controls**

Add compact dark-monitor controls to app/globals.css. Keep the existing 8 px maximum card radius, stable video aspect ratio, readable mobile labels, and current restrained clinical palette.

- [ ] **Step 5: Verify**

Run npm test, npm run typecheck, and npm run build. Expected: all pass without warnings introduced by the new component.

- [ ] **Step 6: Commit**

~~~bash
git add colonoscopy-assessment-platform/components/AssessmentVideoPlayer.tsx colonoscopy-assessment-platform/app/globals.css colonoscopy-assessment-platform/lib/lesionResponse.ts colonoscopy-assessment-platform/lib/lesionResponse.test.ts
git commit -m "feat: add seek-free assessment player"
~~~

---

### Task 5: Add repeated detection controls and finalization flow

**Files:**
- Modify: components/LesionSurvey.tsx
- Modify: components/AssessmentClient.tsx
- Modify: app/globals.css

**Interfaces:**
- LesionSurvey consumes: clickCount, clicks, canDetect, canReportNoLesion, canGoNext, locked
- LesionSurvey produces: onDetect(), onFinalizeYes(), onFinalizeNo()
- AssessmentClient consumes: AssessmentVideoPlayer events and submitVideoResponse

- [ ] **Step 1: Replace the one-shot SurveyJS radio contract**

Keep a SurveyJS Model for the final classification field and validation boundary, but replace the visible one-shot radiogroup with task controls:

- Large red Lesion detected button visible before end.
- Text explaining that the button may be clicked multiple times.
- Visible count and ordered click-time list.
- After end, No lesion detected and Next video buttons.
- Next disabled when clickCount is zero.
- No enabled after end regardless of clickCount.

Use lucide-react icons; do not add hand-drawn SVG.

- [ ] **Step 2: Wire repeated click capture in AssessmentClient**

Replace responseLocked-first-click behavior with detectionClicks state. handleDetect must:

1. Return unless canDetect is true.
2. Read video.currentTime through captureVideoTimeAtClick.
3. Read performance.now().
4. Call createLesionDetectionClick with clickIndex = detectionClicks.length + 1.
5. Append the returned event.
6. Log video_id and the complete event.
7. Never call Supabase.

- [ ] **Step 3: Wire the actual ended event**

Store performance.now() in videoEndedAtRef from AssessmentVideoPlayer.onEnded, set videoEnded = true, disable detection, and expose the two final controls. Do not upload merely because the video ended.

- [ ] **Step 4: Implement mutually exclusive finalization**

Create finalizeVideo(finalClassification, pendingSubmission?) in AssessmentClient.

For yes:

- Require videoEnded and at least one click.
- Build a VideoSubmission from the unchanged click array.
- Lock final controls.
- Call submitVideoResponse.

For no:

- Require videoEnded.
- Build a VideoSubmission before clearing visible state so all raw clicks remain in the payload.
- Set detectionClicks to [] immediately.
- Lock final controls.
- Call submitVideoResponse.

On success, advance to the next queue item or completion page. On error, keep the immutable pending submission and expose Retry submission. Retrying must reuse the exact payload and must not recalculate timings.

- [ ] **Step 5: Reset only when the queue advances**

On currentVideo change, clear playback refs, ended ref, clicks, visible final classification, save error, and pending submission. Do not expose a reset control for the current video.

- [ ] **Step 6: Style and responsive QA**

Add:

- a high-contrast red detection button with stable minimum height;
- a restrained click counter and scroll-safe timing list;
- two post-video final action buttons;
- clear disabled states;
- saving, success, and retry states that do not shift the surrounding layout.

Keep response text concise and avoid instructional marketing copy.

- [ ] **Step 7: Verify**

Run:

~~~bash
npm test
npm run typecheck
npm run build
rg -n "insertResponse|ResponseInsert|responseLockedRef|submittedRef" components lib
~~~

Expected: tests, typecheck, and build pass; rg returns no stale one-shot submission symbols.

- [ ] **Step 8: Commit**

~~~bash
git add colonoscopy-assessment-platform/components/AssessmentClient.tsx colonoscopy-assessment-platform/components/LesionSurvey.tsx colonoscopy-assessment-platform/app/globals.css
git commit -m "feat: support repeated lesion detection and final review"
~~~

---

### Task 6: Update documentation and complete end-to-end verification

**Files:**
- Modify: README.md

**Interfaces:**
- Verifies: participant queue, private video URL, repeated timing, final answer transaction, resume behavior

- [ ] **Step 1: Update README semantics**

Document:

- lesion_detection_events columns;
- final_valid and overridden analysis rules;
- positive first-valid-click summary;
- negative null detection fields;
- no_response_latency_ms definition;
- atomic submit_video_response RPC;
- no anonymous response/event SELECT;
- no forward seek or replay.

- [ ] **Step 2: Run the full local verification suite**

~~~bash
npm test
npm run typecheck
npm run build
npm audit --omit=dev
~~~

Expected: all commands succeed; audit reports zero production vulnerabilities or any exception is reported explicitly.

- [ ] **Step 3: Start or restart the development server**

Use the existing project launch mechanism, confirm only the Next.js app owns port 3000, and verify:

~~~bash
curl -I http://localhost:3000/
~~~

Expected: HTTP 200 from Next.js.

- [ ] **Step 4: Verify the browser workflow**

At desktop and mobile widths:

1. Start a fresh reserved development participant/session.
2. Confirm Supabase queue and signed URL load.
3. Confirm no final controls are usable before end.
4. Confirm repeated red-button clicks increment and retain distinct millisecond times.
5. Confirm pause retains detection availability.
6. Complete playback and verify Next is enabled only with clicks.
7. Verify No clears visible markers.
8. Verify ended video cannot replay.
9. Check there is no overlap or clipped text.

Use a temporary playbackRate override only for browser QA; do not add a playback-rate control to the application.

- [ ] **Step 5: Verify a real transactional submission**

Use a reserved test participant ID, complete one positive and one overridden-negative video, and query the database through Supabase execute_sql to verify:

- exactly one response per video;
- response summary fields follow the final classification;
- all raw events exist;
- overridden and final_valid values are correct;
- get_next_video_order advances exactly once per successful RPC.

Delete only the reserved test participant rows created by this verification from lesion_detection_events, responses, and assessment_queue after recording the results. Do not touch any existing participant data.

- [ ] **Step 6: Re-run advisors and final status checks**

Run Supabase security and performance advisors, npm test, npm run typecheck, and git status --short. Review the final diff for generated artifacts, .env files, or unrelated changes.

- [ ] **Step 7: Commit**

~~~bash
git add colonoscopy-assessment-platform/README.md
git commit -m "docs: explain auditable lesion response workflow"
~~~

## Self-Review

- Every approved behavior maps to a task and a verification step.
- Positive and negative timing types are consistent between TypeScript, RPC parameters, and SQL.
- No step changes queue randomization, session lifecycle, signed URL generation, or existing response rows.
- The plan contains no placeholder implementation steps.
