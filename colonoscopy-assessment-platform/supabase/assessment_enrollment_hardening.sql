-- Coordinator-provisioned enrollment, mode binding, and current-video access.
-- Apply after session_access_hardening.sql. Do not expose private Storage to browsers.

create extension if not exists pgcrypto with schema extensions;

create table if not exists public.assessment_enrollments (
  participant_id text not null,
  session_number integer not null check (session_number between 1 and 3),
  access_code_digest bytea not null check (pg_catalog.octet_length(access_code_digest) = 32),
  study_mode text not null check (study_mode in ('dev', 'formal')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (participant_id, session_number),
  constraint assessment_enrollments_binding_key
    unique (participant_id, session_number, access_code_digest, study_mode)
);

alter table public.assessment_enrollments enable row level security;

revoke all on table public.assessment_enrollments
  from public, anon, authenticated;
revoke all on table public.assessment_runtime_config
  from public, anon, authenticated;
revoke all on table public.assessment_queue
  from public, anon, authenticated;
revoke all on sequence public.assessment_queue_id_seq
  from public, anon, authenticated;
revoke all on table public.videos
  from public, anon, authenticated;

drop policy if exists "Allow anonymous videos lookup"
  on public.videos;
drop policy if exists "Allow anonymous assessment queue lookup"
  on public.assessment_queue;
drop policy if exists "Allow anonymous assessment queue inserts"
  on public.assessment_queue;
drop policy if exists "Allow anonymous queue insert"
  on public.assessment_queue;
drop policy if exists "Allow anonymous queue read"
  on public.assessment_queue;
drop policy if exists "Allow anonymous read of video metadata"
  on public.videos;

revoke all on function public.get_next_video_order(text, integer)
  from public, anon, authenticated;

-- Preserve only old access bindings that a coordinator already enrolled with
-- the exact same digest. Unmatched bindings are credentials, not study data;
-- queues and responses remain untouched and require explicit provisioning.
alter table public.assessment_session_access
  add column if not exists access_code_digest bytea;
alter table public.assessment_session_access
  add column if not exists study_mode text;

update public.assessment_session_access a
set
  access_code_digest = e.access_code_digest,
  study_mode = e.study_mode
from public.assessment_enrollments e
where e.participant_id = a.participant_id
  and e.session_number = a.session_number
  and a.access_token_digest = e.access_code_digest
  and e.active is true;

delete from public.assessment_session_access a
where a.access_code_digest is null
   or a.study_mode is null;

delete from public.assessment_session_access a
where exists (
  select 1
  from lateral (
    select
      pg_catalog.count(*)::integer as legacy_access_queue_count,
      pg_catalog.count(distinct q.video_id)::integer as legacy_access_distinct_video_count,
      pg_catalog.count(distinct q.video_order)::integer as legacy_access_distinct_order_count,
      pg_catalog.min(q.video_order) as legacy_access_min_video_order,
      pg_catalog.max(q.video_order) as legacy_access_max_video_order
    from public.assessment_queue q
    where q.participant_id = a.participant_id
      and q.session_number = a.session_number
  ) queue_shape
  where queue_shape.legacy_access_queue_count > 0
    and (
      queue_shape.legacy_access_distinct_video_count
        <> queue_shape.legacy_access_queue_count
      or queue_shape.legacy_access_distinct_order_count
        <> queue_shape.legacy_access_queue_count
      or queue_shape.legacy_access_min_video_order <> 1
      or queue_shape.legacy_access_max_video_order
        <> queue_shape.legacy_access_queue_count
      or queue_shape.legacy_access_queue_count <> (
        select pg_catalog.count(*)::integer
        from public.videos v
        where (a.study_mode = 'dev' and v.is_test is true)
           or (
             a.study_mode = 'formal'
             and v.is_test is false
             and v.session_pool = a.session_number
           )
      )
      or (a.study_mode = 'formal' and legacy_access_queue_count <> 40)
      or exists (
        select 1
        from public.assessment_queue q
        left join public.videos v on v.video_id = q.video_id
        where q.participant_id = a.participant_id
          and q.session_number = a.session_number
          and (
            v.video_id is null
            or (
              case
                when a.study_mode = 'dev' then v.is_test is true
                else v.is_test is false and v.session_pool = a.session_number
              end
            ) is not true
          )
      )
      or exists (
        select 1
        from public.videos v
        where (
          (a.study_mode = 'dev' and v.is_test is true)
          or (
            a.study_mode = 'formal'
            and v.is_test is false
            and v.session_pool = a.session_number
          )
        )
          and not exists (
            select 1
            from public.assessment_queue q
            where q.participant_id = a.participant_id
              and q.session_number = a.session_number
              and q.video_id = v.video_id
          )
      )
    )
);

alter table public.assessment_session_access
  alter column access_code_digest set not null;
alter table public.assessment_session_access
  alter column study_mode set not null;
alter table public.assessment_session_access
  drop column access_token_digest;
alter table public.assessment_session_access
  add constraint assessment_session_access_digest_check
    check (pg_catalog.octet_length(access_code_digest) = 32);
alter table public.assessment_session_access
  add constraint assessment_session_access_study_mode_check
    check (study_mode in ('dev', 'formal'));
alter table public.assessment_session_access
  add constraint assessment_session_access_enrollment_fkey
    foreign key (participant_id, session_number, access_code_digest, study_mode)
    references public.assessment_enrollments (
      participant_id,
      session_number,
      access_code_digest,
      study_mode
    )
    on update restrict
    on delete cascade;

revoke all on table public.assessment_session_access
  from public, anon, authenticated;

-- Remove every known anonymous video-read policy before dropping its helper.
drop policy if exists "Allow anonymous V001 signed URL reads"
  on storage.objects;
drop policy if exists "Allow anonymous V001 video reads"
  on storage.objects;
drop policy if exists "Allow anonymous signed URL reads for video objects"
  on storage.objects;
drop policy if exists "Allow read access to SSL videos 1rl8_0"
  on storage.objects;

revoke all on function public.can_read_assessment_video_object(text, text)
  from public, anon, authenticated, service_role;
drop function if exists public.can_read_assessment_video_object(text, text);

drop function if exists public.start_or_resume_assessment(text, integer, text);

create or replace function public.start_or_resume_assessment(
  p_participant_id text,
  p_session_number integer,
  p_access_code text
)
returns table (
  video_id text,
  video_order integer,
  next_video_order integer,
  queue_length integer,
  study_mode text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  provided_digest bytea;
  enrollment_digest bytea;
  enrollment_mode text;
  stored_digest bytea;
  stored_mode text;
  normalized_mode text;
  existing_queue_length integer;
  legacy_queue_matches_mode boolean;
  legacy_distinct_video_count integer;
  legacy_distinct_order_count integer;
  legacy_min_video_order integer;
  legacy_max_video_order integer;
  queue_is_eligible_set boolean;
  eligible_pool_is_queued boolean;
  eligible_video_count integer;
  resolved_next_video_order integer;
begin
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_participant_id, ''))) = 0 then
    raise exception 'participant_id is required';
  end if;

  if p_session_number is null or p_session_number not between 1 and 3 then
    raise exception 'session_number must be 1, 2, or 3';
  end if;

  if pg_catalog.length(coalesce(p_access_code, '')) < 20 then
    raise exception 'assessment credentials are invalid';
  end if;

  select c.study_mode
  into normalized_mode
  from public.assessment_runtime_config c
  where c.id = 1;

  if not found then
    raise exception 'assessment runtime configuration is missing';
  end if;

  provided_digest := extensions.digest(p_access_code, 'sha256');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_participant_id || ':' || p_session_number::text,
      0
    )
  );

  select e.access_code_digest, e.study_mode
  into enrollment_digest, enrollment_mode
  from public.assessment_enrollments e
  where e.participant_id = p_participant_id
    and e.session_number = p_session_number
    and e.active is true
    and e.study_mode = normalized_mode;

  if not found or enrollment_digest is distinct from provided_digest then
    raise exception 'assessment credentials are invalid';
  end if;

  select a.access_code_digest, a.study_mode
  into stored_digest, stored_mode
  from public.assessment_session_access a
  where a.participant_id = p_participant_id
    and a.session_number = p_session_number;

  if found and (
    stored_digest is distinct from enrollment_digest
    or stored_mode is distinct from normalized_mode
  ) then
    raise exception 'assessment credentials are invalid';
  end if;

  select pg_catalog.count(*)::integer
  into eligible_video_count
  from public.videos v
  where (normalized_mode = 'dev' and v.is_test is true)
     or (
       normalized_mode = 'formal'
       and v.is_test is false
       and v.session_pool = p_session_number
     );

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(distinct q.video_id)::integer,
    pg_catalog.count(distinct q.video_order)::integer,
    pg_catalog.min(q.video_order),
    pg_catalog.max(q.video_order)
  into
    existing_queue_length,
    legacy_distinct_video_count,
    legacy_distinct_order_count,
    legacy_min_video_order,
    legacy_max_video_order
  from public.assessment_queue q
  where q.participant_id = p_participant_id
    and q.session_number = p_session_number;

  if existing_queue_length > 0 then
    select not exists (
      select 1
      from public.assessment_queue q
      left join public.videos v on v.video_id = q.video_id
      where q.participant_id = p_participant_id
        and q.session_number = p_session_number
        and (
          v.video_id is null
          or (
            case
              when normalized_mode = 'dev' then v.is_test is true
              else v.is_test is false and v.session_pool = p_session_number
            end
          ) is not true
        )
    )
    into queue_is_eligible_set;

    select not exists (
      select 1
      from public.videos v
      where (
        (normalized_mode = 'dev' and v.is_test is true)
        or (
          normalized_mode = 'formal'
          and v.is_test is false
          and v.session_pool = p_session_number
        )
      )
        and not exists (
          select 1
          from public.assessment_queue q
          where q.participant_id = p_participant_id
            and q.session_number = p_session_number
            and q.video_id = v.video_id
        )
    )
    into eligible_pool_is_queued;

    legacy_queue_matches_mode :=
      queue_is_eligible_set
      and eligible_pool_is_queued
      and existing_queue_length = eligible_video_count
      and legacy_distinct_video_count = existing_queue_length
      and legacy_distinct_order_count = existing_queue_length
      and legacy_min_video_order = 1
      and legacy_max_video_order = existing_queue_length
      and (
        normalized_mode <> 'formal'
        or eligible_video_count = 40
      );

    if legacy_queue_matches_mode is not true then
      raise exception 'legacy queue does not match configured study mode or exact eligible pool';
    end if;
  end if;

  if stored_digest is null then
    insert into public.assessment_session_access (
      participant_id,
      session_number,
      access_code_digest,
      study_mode
    )
    values (
      p_participant_id,
      p_session_number,
      enrollment_digest,
      normalized_mode
    );
  end if;

  if existing_queue_length = 0 then
    if normalized_mode = 'formal' and eligible_video_count <> 40 then
      raise exception using message = pg_catalog.format(
        'Session %s is not ready: %s/40 formal videos configured.',
        p_session_number,
        eligible_video_count
      );
    end if;

    if normalized_mode = 'dev' and eligible_video_count = 0 then
      raise exception 'No development videos are configured.';
    end if;

    insert into public.assessment_queue (
      participant_id,
      session_number,
      video_id,
      video_order
    )
    select
      p_participant_id,
      p_session_number,
      eligible.video_id,
      eligible.video_order
    from (
      select
        v.video_id,
        pg_catalog.row_number() over (order by pg_catalog.random())::integer as video_order
      from public.videos v
      where (normalized_mode = 'dev' and v.is_test is true)
         or (
           normalized_mode = 'formal'
           and v.is_test is false
           and v.session_pool = p_session_number
         )
    ) eligible;
  end if;

  select pg_catalog.count(*)::integer
  into existing_queue_length
  from public.assessment_queue q
  where q.participant_id = p_participant_id
    and q.session_number = p_session_number;

  select coalesce(
    (
      select pg_catalog.min(q.video_order)
      from public.assessment_queue q
      where q.participant_id = p_participant_id
        and q.session_number = p_session_number
        and not exists (
          select 1
          from public.responses r
          where r.participant_id = q.participant_id
            and r.session_number = q.session_number
            and r.video_id = q.video_id
            and r.video_order = q.video_order
        )
    ),
    existing_queue_length + 1
  )
  into resolved_next_video_order;

  return query
  select
    q.video_id,
    q.video_order,
    resolved_next_video_order,
    existing_queue_length,
    normalized_mode
  from public.assessment_queue q
  where q.participant_id = p_participant_id
    and q.session_number = p_session_number
  order by q.video_order;
end;
$$;

drop function if exists public.submit_video_response(
  text,
  integer,
  text,
  integer,
  boolean,
  bigint,
  bigint,
  boolean,
  jsonb
);

drop function if exists public.submit_video_response(
  text,
  integer,
  text,
  integer,
  boolean,
  bigint,
  bigint,
  boolean,
  jsonb,
  text
);

create or replace function public.submit_video_response(
  p_participant_id text,
  p_session_number integer,
  p_video_id text,
  p_video_order integer,
  p_answer boolean,
  p_response_time_ms bigint,
  p_no_response_latency_ms bigint,
  p_video_completed boolean,
  p_clicks jsonb,
  p_access_code text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  provided_digest bytea;
  enrollment_digest bytea;
  stored_digest bytea;
  normalized_mode text;
  stored_mode text;
  video_has_lesion boolean;
  video_lesion_onset_sec double precision;
  click_count integer;
  distinct_click_count integer;
  minimum_click_index integer;
  maximum_click_index integer;
  first_video_time double precision;
  first_response_time_ms bigint;
  first_detection_latency_ms bigint;
  current_video_order integer;
  existing_response public.responses%rowtype;
  expected_events jsonb;
  stored_events jsonb;
begin
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_participant_id, ''))) = 0 then
    raise exception 'participant_id is required';
  end if;

  if p_session_number is null or p_session_number not between 1 and 3 then
    raise exception 'session_number must be 1, 2, or 3';
  end if;

  if pg_catalog.length(coalesce(p_access_code, '')) < 20 then
    raise exception 'assessment credentials are invalid';
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

  if p_clicks is null or pg_catalog.jsonb_typeof(p_clicks) <> 'array' then
    raise exception 'p_clicks must be a JSON array';
  end if;

  select c.study_mode
  into normalized_mode
  from public.assessment_runtime_config c
  where c.id = 1;

  if not found then
    raise exception 'assessment runtime configuration is missing';
  end if;

  provided_digest := extensions.digest(p_access_code, 'sha256');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_participant_id || ':' || p_session_number::text,
      0
    )
  );

  select e.access_code_digest
  into enrollment_digest
  from public.assessment_enrollments e
  where e.participant_id = p_participant_id
    and e.session_number = p_session_number
    and e.active is true
    and e.study_mode = normalized_mode;

  if not found or enrollment_digest is distinct from provided_digest then
    raise exception 'assessment credentials are invalid';
  end if;

  select a.access_code_digest, a.study_mode
  into stored_digest, stored_mode
  from public.assessment_session_access a
  where a.participant_id = p_participant_id
    and a.session_number = p_session_number;

  if not found
     or stored_digest is distinct from enrollment_digest
     or stored_mode is distinct from normalized_mode then
    raise exception 'assessment credentials are invalid';
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

  select
    pg_catalog.count(*)::integer,
    pg_catalog.count(distinct click_row.click_index)::integer,
    pg_catalog.min(click_row.click_index),
    pg_catalog.max(click_row.click_index)
  into
    click_count,
    distinct_click_count,
    minimum_click_index,
    maximum_click_index
  from pg_catalog.jsonb_to_recordset(p_clicks) as click_row(
    click_index integer,
    video_time_at_click double precision,
    response_time_ms bigint
  );

  if p_answer is true and click_count = 0 then
    raise exception 'positive responses require at least one lesion click';
  end if;

  if exists (
    select 1
    from pg_catalog.jsonb_to_recordset(p_clicks) as click_row(
      click_index integer,
      video_time_at_click double precision,
      response_time_ms bigint
    )
    where click_row.click_index is null
       or click_row.click_index < 1
       or click_row.video_time_at_click is null
       or click_row.video_time_at_click < 0
       or click_row.response_time_ms is null
       or click_row.response_time_ms < 0
  ) then
    raise exception 'click timing values are invalid';
  end if;

  if click_count > 0 and (
    distinct_click_count <> click_count
    or minimum_click_index <> 1
    or maximum_click_index <> click_count
  ) then
    raise exception 'click indexes must be unique and contiguous from 1';
  end if;

  if p_answer is true then
    select
      pg_catalog.round(click_row.video_time_at_click::numeric, 3)::double precision,
      click_row.response_time_ms,
      case
        when video_lesion_onset_sec is null then null
        else pg_catalog.round(
          (
            pg_catalog.round(click_row.video_time_at_click::numeric, 3)::double precision
            - video_lesion_onset_sec
          ) * 1000
        )::bigint
      end
    into
      first_video_time,
      first_response_time_ms,
      first_detection_latency_ms
    from pg_catalog.jsonb_to_recordset(p_clicks) as click_row(
      click_index integer,
      video_time_at_click double precision,
      response_time_ms bigint
    )
    order by click_row.click_index
    limit 1;

    if p_answer is true and p_response_time_ms <> first_response_time_ms then
      raise exception 'positive response_time_ms must equal the first lesion click response_time_ms';
    end if;
  end if;

  select coalesce(
    pg_catalog.jsonb_agg(
      pg_catalog.jsonb_build_array(
        click_row.click_index,
        pg_catalog.round(click_row.video_time_at_click::numeric, 3)::double precision,
        click_row.response_time_ms,
        video_lesion_onset_sec,
        case
          when video_lesion_onset_sec is null then null
          else pg_catalog.round(
            (
              pg_catalog.round(click_row.video_time_at_click::numeric, 3)::double precision
              - video_lesion_onset_sec
            ) * 1000
          )::bigint
        end,
        not p_answer,
        p_answer
      )
      order by click_row.click_index
    ),
    '[]'::jsonb
  )
  into expected_events
  from pg_catalog.jsonb_to_recordset(p_clicks) as click_row(
    click_index integer,
    video_time_at_click double precision,
    response_time_ms bigint
  );

  select r.*
  into existing_response
  from public.responses r
  where r.participant_id = p_participant_id
    and r.session_number = p_session_number
    and r.video_id = p_video_id
    and r.video_order = p_video_order;

  if found then
    select coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_array(
          e.click_index,
          e.video_time_at_click,
          e.response_time_ms,
          e.lesion_onset_sec,
          e.detection_latency_ms,
          e.overridden,
          e.final_valid
        )
        order by e.click_index
      ),
      '[]'::jsonb
    )
    into stored_events
    from public.lesion_detection_events e
    where e.participant_id = p_participant_id
      and e.session_number = p_session_number
      and e.video_id = p_video_id
      and e.video_order = p_video_order;

    -- An idempotent replay returns success only for the exact committed payload.
    if existing_response.answer = p_answer
       and existing_response.correct = (video_has_lesion = p_answer)
       and existing_response.response_time_ms = p_response_time_ms
       and existing_response.video_time_at_click is not distinct from (case when p_answer then first_video_time else null end)
       and existing_response.detection_latency_ms is not distinct from (case when p_answer then first_detection_latency_ms else null end)
       and existing_response.response_type = (case when p_answer then 'lesion_detected' else 'no_lesion_detected' end)
       and existing_response.video_completed is true
       and existing_response.no_response_latency_ms is not distinct from (case when p_answer then null else p_no_response_latency_ms end)
       and stored_events = expected_events then
      return;
    end if;

    raise exception 'existing response differs from retry payload';
  end if;

  -- New submissions may only write the first unanswered queue order.
  select pg_catalog.min(q.video_order)
  into current_video_order
  from public.assessment_queue q
  where q.participant_id = p_participant_id
    and q.session_number = p_session_number
    and not exists (
      select 1
      from public.responses r
      where r.participant_id = q.participant_id
        and r.session_number = q.session_number
        and r.video_id = q.video_id
        and r.video_order = q.video_order
    );

  if current_video_order is null then
    raise exception 'assessment session is already complete';
  end if;

  if p_video_order <> current_video_order then
    raise exception 'submission must target the first unanswered queue order';
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
    pg_catalog.round(click_row.video_time_at_click::numeric, 3)::double precision,
    click_row.response_time_ms,
    video_lesion_onset_sec,
    case
      when video_lesion_onset_sec is null then null
      else pg_catalog.round(
        (
          pg_catalog.round(click_row.video_time_at_click::numeric, 3)::double precision
          - video_lesion_onset_sec
        ) * 1000
      )::bigint
    end,
    not p_answer,
    p_answer
  from pg_catalog.jsonb_to_recordset(p_clicks) as click_row(
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
    case when p_answer then first_response_time_ms else p_response_time_ms end,
    case when p_answer then first_video_time else null end,
    case when p_answer then first_detection_latency_ms else null end,
    case when p_answer then 'lesion_detected' else 'no_lesion_detected' end,
    true,
    case when p_answer then null else p_no_response_latency_ms end
  );
end;
$$;

create or replace function public.authorize_current_assessment_video(
  p_participant_id text,
  p_session_number integer,
  p_video_order integer,
  p_access_code text
)
returns table (
  bucket text,
  file_path text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  provided_digest bytea;
  enrollment_digest bytea;
  stored_digest bytea;
  normalized_mode text;
  stored_mode text;
  current_video_order integer;
begin
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_participant_id, ''))) = 0
     or p_session_number is null
     or p_session_number not between 1 and 3
     or pg_catalog.length(coalesce(p_access_code, '')) < 20 then
    raise exception 'assessment credentials are invalid';
  end if;

  select c.study_mode
  into normalized_mode
  from public.assessment_runtime_config c
  where c.id = 1;

  if not found then
    raise exception 'assessment runtime configuration is missing';
  end if;

  provided_digest := extensions.digest(p_access_code, 'sha256');
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_participant_id || ':' || p_session_number::text,
      0
    )
  );

  select e.access_code_digest
  into enrollment_digest
  from public.assessment_enrollments e
  where e.participant_id = p_participant_id
    and e.session_number = p_session_number
    and e.active is true
    and e.study_mode = normalized_mode;

  if not found or enrollment_digest is distinct from provided_digest then
    raise exception 'assessment credentials are invalid';
  end if;

  select a.access_code_digest, a.study_mode
  into stored_digest, stored_mode
  from public.assessment_session_access a
  where a.participant_id = p_participant_id
    and a.session_number = p_session_number;

  if not found
     or stored_digest is distinct from enrollment_digest
     or stored_mode is distinct from normalized_mode then
    raise exception 'assessment credentials are invalid';
  end if;

  select pg_catalog.min(q.video_order)
  into current_video_order
  from public.assessment_queue q
  where q.participant_id = p_participant_id
    and q.session_number = p_session_number
    and not exists (
      select 1
      from public.responses r
      where r.participant_id = q.participant_id
        and r.session_number = q.session_number
        and r.video_id = q.video_id
        and r.video_order = q.video_order
    );

  if current_video_order is null or p_video_order <> current_video_order then
    raise exception 'assessment video is not available';
  end if;

  return query
  select v.bucket, v.file_path
  from public.assessment_queue q
  join public.videos v on v.video_id = q.video_id
  where q.participant_id = p_participant_id
    and q.session_number = p_session_number
    and q.video_order = p_video_order;

  if not found then
    raise exception 'assessment video is not available';
  end if;
end;
$$;

revoke all on function public.start_or_resume_assessment(text, integer, text)
  from public, authenticated;
grant execute on function public.start_or_resume_assessment(text, integer, text)
  to anon;

revoke all on function public.submit_video_response(
  text,
  integer,
  text,
  integer,
  boolean,
  bigint,
  bigint,
  boolean,
  jsonb,
  text
) from public, authenticated;
grant execute on function public.submit_video_response(
  text,
  integer,
  text,
  integer,
  boolean,
  bigint,
  bigint,
  boolean,
  jsonb,
  text
) to anon;

revoke all on function public.authorize_current_assessment_video(
  text,
  integer,
  integer,
  text
) from public, anon, authenticated;
grant execute on function public.authorize_current_assessment_video(
  text,
  integer,
  integer,
  text
) to service_role;

comment on function public.start_or_resume_assessment(text, integer, text)
is 'SECURITY DEFINER is intentional: a coordinator-provisioned access code and authoritative mode bind server-owned queue creation and resume data.';

comment on function public.submit_video_response(text, integer, text, integer, boolean, bigint, bigint, boolean, jsonb, text)
is 'SECURITY DEFINER is intentional: active enrollment, bound mode, first-unanswered-order checks, and exact idempotent replay protect the atomic response boundary.';

comment on function public.authorize_current_assessment_video(text, integer, integer, text)
is 'SECURITY DEFINER is service-role-only: it releases one current private Storage object after enrollment, mode, binding, and progress checks.';
