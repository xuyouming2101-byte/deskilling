-- P01-P60 participant schedule.
-- All opens_at values start NULL.
-- First ordinary Session 1 login atomically sets:
--   S1 = Day 0
--   S2 = Day 0 + 14 days
--   S3 = Day 0 + 28 days
-- Master password bypass does not alter Day 0.

create table if not exists public.participant_session_schedule (
  participant_id text not null,
  session_number integer not null,
  opens_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (participant_id, session_number),
  constraint participant_session_schedule_participant_check
    check (participant_id ~ '^P(0[1-9]|[1-5][0-9]|60)$'),
  constraint participant_session_schedule_session_check
    check (session_number between 1 and 3)
);

alter table public.participant_session_schedule enable row level security;

insert into public.participant_session_schedule (
  participant_id,
  session_number,
  opens_at
)
select
  'P' || lpad(p::text, 2, '0'),
  s,
  null
from generate_series(1, 60) as p
cross join generate_series(1, 3) as s
on conflict (participant_id, session_number) do nothing;

create or replace function public.claim_participant_session_access(
  p_participant_id text,
  p_session_number integer
)
returns table (
  opens_at timestamptz,
  server_now timestamptz,
  is_open boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_s1_opens_at timestamptz;
  v_requested_opens_at timestamptz;
  v_row_count integer;
begin
  if p_participant_id is null
     or p_participant_id !~ '^P(0[1-9]|[1-5][0-9]|60)$' then
    raise exception 'invalid participant_id';
  end if;

  if p_session_number is null or p_session_number not between 1 and 3 then
    raise exception 'invalid session_number';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_participant_id, 0)
  );

  select pg_catalog.count(*)::integer
  into v_row_count
  from public.participant_session_schedule s
  where s.participant_id = p_participant_id;

  if v_row_count <> 3 then
    raise exception 'participant schedule is incomplete';
  end if;

  select s.opens_at
  into v_s1_opens_at
  from public.participant_session_schedule s
  where s.participant_id = p_participant_id
    and s.session_number = 1;

  if p_session_number = 1 and v_s1_opens_at is null then
    update public.participant_session_schedule
    set opens_at = case session_number
      when 1 then v_now
      when 2 then v_now + interval '14 days'
      when 3 then v_now + interval '28 days'
    end,
    updated_at = v_now
    where participant_id = p_participant_id;
  end if;

  select s.opens_at
  into v_requested_opens_at
  from public.participant_session_schedule s
  where s.participant_id = p_participant_id
    and s.session_number = p_session_number;

  return query
  select
    v_requested_opens_at,
    v_now,
    (v_requested_opens_at is not null and v_now >= v_requested_opens_at);
end;
$$;

revoke all on function public.claim_participant_session_access(text, integer) from public;
revoke all on function public.claim_participant_session_access(text, integer) from anon;
grant execute on function public.claim_participant_session_access(text, integer) to service_role;
