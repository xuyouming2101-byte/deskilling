-- Approved Test 1 AI-ON integration. No historical research row is modified.
-- Lesion-specific type was not supplied: NULL is intentional, not video-type inference.
-- Source workbook SHA256: b5a035c4518a59e01e6edd64cbb55327893ba3f5e5c8afdaf93b8c2da14f0079
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
LOCK TABLE public.videos, public.assessment_queue, public.responses,
  public.lesion_detection_events, public.participant_session_schedule IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE aion_before (name text PRIMARY KEY, digest text) ON COMMIT DROP;
DO $guard$
DECLARE t text; guard_started boolean;
BEGIN
  IF md5(pg_get_functiondef('public.start_or_resume_assessment(text,integer)'::regprocedure)) <> '7daf926700588c03fb2febb813448687' THEN
    RAISE EXCEPTION 'Unexpected start function; stop without writing';
  END IF;
  IF (SELECT count(*) FROM public.videos) <> 40 OR EXISTS
    (SELECT 1 FROM public.videos WHERE video_id !~ '^T1_(00[1-9]|0[1-3][0-9]|040)$' OR ai_condition IS DISTINCT FROM 'off' OR session_pool IS DISTINCT FROM 1 OR is_test) THEN
    RAISE EXCEPTION 'Unexpected existing OFF pool';
  END IF;
  IF (SELECT study_mode FROM public.assessment_runtime_config WHERE id=1) IS DISTINCT FROM 'formal' THEN
    RAISE EXCEPTION 'Expected formal mode';
  END IF;
  IF (SELECT count(*) FROM public.participant_session_schedule WHERE participant_id ~ '^P(2[1-9]|3[0-9]|40)$' AND session_number=1) <> 20
    OR EXISTS(SELECT 1 FROM public.participant_session_schedule WHERE participant_id ~ '^P(2[1-9]|3[0-9]|40)$' AND session_number=1 AND opens_at IS NOT NULL) THEN
    RAISE EXCEPTION 'AI-ON participants already started or roster incomplete';
  END IF;
  FOREACH t IN ARRAY ARRAY['assessment_queue','responses','lesion_detection_events'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name=t) THEN
      EXECUTE format('SELECT EXISTS (SELECT 1 FROM public.%I WHERE participant_id ~ ''^P(2[1-9]|3[0-9]|40)$'' AND session_number=1)',t) INTO STRICT guard_started;
      IF guard_started THEN RAISE EXCEPTION 'Existing AI-ON participant records in %', t; END IF;
    END IF;
  END LOOP;
END
$guard$;

DO $snapshot$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['videos','assessment_queue','responses','lesion_detection_events','participant_session_schedule'] LOOP
    EXECUTE format('INSERT INTO aion_before SELECT %L, md5(coalesce(string_agg(to_jsonb(r)::text, E''\n'' ORDER BY to_jsonb(r)::text),'''')) FROM public.%I r',t,t);
  END LOOP;
END $snapshot$;
SET LOCAL ROLE deskilling_owner;
CREATE TABLE public.video_lesions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  video_id text NOT NULL REFERENCES public.videos(video_id) ON DELETE RESTRICT,
  lesion_index integer NOT NULL CHECK (lesion_index > 0),
  lesion_type text,
  cut_begin_sec numeric NOT NULL CHECK (cut_begin_sec >= 0 AND cut_begin_sec < 'Infinity'::numeric),
  cut_end_sec numeric NOT NULL CHECK (cut_end_sec >= cut_begin_sec AND cut_end_sec < 'Infinity'::numeric),
  source_file text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(video_id, lesion_index)
);
REVOKE ALL ON public.video_lesions FROM PUBLIC, deskilling_app;
REVOKE ALL ON SEQUENCE public.video_lesions_id_seq FROM PUBLIC, deskilling_app;
INSERT INTO public.videos(video_id,file_path,bucket,has_lesion,type,ai_condition,session_pool,is_test,lesion_onset_sec) VALUES
('AION_T1_001', 'Test1/AION/videos/01_ai.mp4', 'FORMAL_ECS', true, 'subtle', 'on', 1, false, NULL),
('AION_T1_002', 'Test1/AION/videos/02_ai.mp4', 'FORMAL_ECS', true, 'obvious', 'on', 1, false, NULL),
('AION_T1_003', 'Test1/AION/videos/03_ai.mp4', 'FORMAL_ECS', true, 'obvious', 'on', 1, false, NULL),
('AION_T1_004', 'Test1/AION/videos/04_ai.mp4', 'FORMAL_ECS', true, 'obvious', 'on', 1, false, NULL),
('AION_T1_005', 'Test1/AION/videos/05_ai.mp4', 'FORMAL_ECS', true, 'obvious', 'on', 1, false, NULL),
('AION_T1_006', 'Test1/AION/videos/06_ai.mp4', 'FORMAL_ECS', true, 'obvious', 'on', 1, false, NULL),
('AION_T1_007', 'Test1/AION/videos/07_ai.mp4', 'FORMAL_ECS', true, 'obvious', 'on', 1, false, NULL),
('AION_T1_008', 'Test1/AION/videos/08_ai.mp4', 'FORMAL_ECS', true, 'obvious', 'on', 1, false, NULL),
('AION_T1_009', 'Test1/AION/videos/09_ai.mp4', 'FORMAL_ECS', true, 'subtle', 'on', 1, false, NULL),
('AION_T1_010', 'Test1/AION/videos/10_ai.mp4', 'FORMAL_ECS', true, 'subtle', 'on', 1, false, NULL),
('AION_T1_011', 'Test1/AION/videos/11_ai.mp4', 'FORMAL_ECS', true, 'obvious', 'on', 1, false, NULL),
('AION_T1_012', 'Test1/AION/videos/12_ai.mp4', 'FORMAL_ECS', true, 'subtle', 'on', 1, false, NULL),
('AION_T1_013', 'Test1/AION/videos/13_ai.mp4', 'FORMAL_ECS', true, 'subtle', 'on', 1, false, NULL),
('AION_T1_014', 'Test1/AION/videos/14_ai.mp4', 'FORMAL_ECS', true, 'subtle', 'on', 1, false, NULL),
('AION_T1_015', 'Test1/AION/videos/15_ai.mp4', 'FORMAL_ECS', true, 'obvious', 'on', 1, false, NULL),
('AION_T1_016', 'Test1/AION/videos/16_ai.mp4', 'FORMAL_ECS', true, 'obvious', 'on', 1, false, NULL),
('AION_T1_017', 'Test1/AION/videos/17_ai.mp4', 'FORMAL_ECS', true, 'obvious', 'on', 1, false, NULL),
('AION_T1_018', 'Test1/AION/videos/18_ai.mp4', 'FORMAL_ECS', true, 'obvious', 'on', 1, false, NULL),
('AION_T1_019', 'Test1/AION/videos/19_ai.mp4', 'FORMAL_ECS', true, 'obvious', 'on', 1, false, NULL),
('AION_T1_020', 'Test1/AION/videos/20_ai.mp4', 'FORMAL_ECS', true, 'obvious', 'on', 1, false, NULL),
('AION_T1_021', 'Test1/AION/videos/21_ai.mp4', 'FORMAL_ECS', true, 'ssl', 'on', 1, false, NULL),
('AION_T1_022', 'Test1/AION/videos/22_ai.mp4', 'FORMAL_ECS', true, 'ssl', 'on', 1, false, NULL),
('AION_T1_023', 'Test1/AION/videos/23_ai.mp4', 'FORMAL_ECS', true, 'ssl', 'on', 1, false, NULL),
('AION_T1_024', 'Test1/AION/videos/24_ai.mp4', 'FORMAL_ECS', true, 'ssl', 'on', 1, false, NULL),
('AION_T1_025', 'Test1/AION/videos/25_ai.mp4', 'FORMAL_ECS', false, 'no_lesion', 'on', 1, false, NULL),
('AION_T1_026', 'Test1/AION/videos/26_ai.mp4', 'FORMAL_ECS', false, 'no_lesion', 'on', 1, false, NULL),
('AION_T1_027', 'Test1/AION/videos/27_ai.mp4', 'FORMAL_ECS', false, 'no_lesion', 'on', 1, false, NULL),
('AION_T1_028', 'Test1/AION/videos/28_ai.mp4', 'FORMAL_ECS', false, 'no_lesion', 'on', 1, false, NULL),
('AION_T1_029', 'Test1/AION/videos/29_ai.mp4', 'FORMAL_ECS', false, 'no_lesion', 'on', 1, false, NULL),
('AION_T1_030', 'Test1/AION/videos/30_ai.mp4', 'FORMAL_ECS', false, 'no_lesion', 'on', 1, false, NULL),
('AION_T1_031', 'Test1/AION/videos/31_ai.mp4', 'FORMAL_ECS', false, 'no_lesion', 'on', 1, false, NULL),
('AION_T1_032', 'Test1/AION/videos/32_ai.mp4', 'FORMAL_ECS', false, 'no_lesion', 'on', 1, false, NULL),
('AION_T1_033', 'Test1/AION/videos/33_ai.mp4', 'FORMAL_ECS', false, 'no_lesion', 'on', 1, false, NULL),
('AION_T1_034', 'Test1/AION/videos/34_ai.mp4', 'FORMAL_ECS', false, 'no_lesion', 'on', 1, false, NULL),
('AION_T1_035', 'Test1/AION/videos/35_ai.mp4', 'FORMAL_ECS', false, 'no_lesion', 'on', 1, false, NULL),
('AION_T1_036', 'Test1/AION/videos/36_ai.mp4', 'FORMAL_ECS', false, 'no_lesion', 'on', 1, false, NULL),
('AION_T1_037', 'Test1/AION/videos/37_ai.mp4', 'FORMAL_ECS', false, 'no_lesion', 'on', 1, false, NULL),
('AION_T1_038', 'Test1/AION/videos/38_ai.mp4', 'FORMAL_ECS', false, 'no_lesion', 'on', 1, false, NULL),
('AION_T1_039', 'Test1/AION/videos/39_ai.mp4', 'FORMAL_ECS', false, 'no_lesion', 'on', 1, false, NULL),
('AION_T1_040', 'Test1/AION/videos/40_ai.mp4', 'FORMAL_ECS', false, 'no_lesion', 'on', 1, false, NULL);
INSERT INTO public.video_lesions(video_id,lesion_index,lesion_type,cut_begin_sec,cut_end_sec,source_file) VALUES
('AION_T1_001', 1, NULL, 52.0, 56.0, 'Test 1 manifest.xlsx'),
('AION_T1_002', 1, NULL, 86.0, 91.0, 'Test 1 manifest.xlsx'),
('AION_T1_003', 1, NULL, 92.0, 96.0, 'Test 1 manifest.xlsx'),
('AION_T1_004', 1, NULL, 39.0, 41.0, 'Test 1 manifest.xlsx'),
('AION_T1_004', 2, NULL, 57.0, 61.0, 'Test 1 manifest.xlsx'),
('AION_T1_005', 1, NULL, 55.0, 61.0, 'Test 1 manifest.xlsx'),
('AION_T1_005', 2, NULL, 81.0, 82.0, 'Test 1 manifest.xlsx'),
('AION_T1_006', 1, NULL, 11.0, 17.0, 'Test 1 manifest.xlsx'),
('AION_T1_006', 2, NULL, 96.0, 101.0, 'Test 1 manifest.xlsx'),
('AION_T1_007', 1, NULL, 47.0, 49.0, 'Test 1 manifest.xlsx'),
('AION_T1_007', 2, NULL, 65.0, 66.0, 'Test 1 manifest.xlsx'),
('AION_T1_008', 1, NULL, 28.0, 31.0, 'Test 1 manifest.xlsx'),
('AION_T1_009', 1, NULL, 72.0, 74.0, 'Test 1 manifest.xlsx'),
('AION_T1_009', 2, NULL, 89.0, 92.0, 'Test 1 manifest.xlsx'),
('AION_T1_010', 1, NULL, 94.0, 97.0, 'Test 1 manifest.xlsx'),
('AION_T1_011', 1, NULL, 11.0, 14.0, 'Test 1 manifest.xlsx'),
('AION_T1_011', 2, NULL, 28.0, 33.0, 'Test 1 manifest.xlsx'),
('AION_T1_012', 1, NULL, 27.0, 32.0, 'Test 1 manifest.xlsx'),
('AION_T1_012', 2, NULL, 51.0, 54.0, 'Test 1 manifest.xlsx'),
('AION_T1_013', 1, NULL, 67.0, 71.0, 'Test 1 manifest.xlsx'),
('AION_T1_014', 1, NULL, 65.0, 68.0, 'Test 1 manifest.xlsx'),
('AION_T1_014', 2, NULL, 81.0, 84.0, 'Test 1 manifest.xlsx'),
('AION_T1_015', 1, NULL, 87.0, 89.0, 'Test 1 manifest.xlsx'),
('AION_T1_016', 1, NULL, 69.0, 72.0, 'Test 1 manifest.xlsx'),
('AION_T1_017', 1, NULL, 12.0, 20.0, 'Test 1 manifest.xlsx'),
('AION_T1_017', 2, NULL, 48.0, 51.0, 'Test 1 manifest.xlsx'),
('AION_T1_018', 1, NULL, 64.0, 71.0, 'Test 1 manifest.xlsx'),
('AION_T1_018', 2, NULL, 87.0, 93.0, 'Test 1 manifest.xlsx'),
('AION_T1_019', 1, NULL, 56.0, 66.0, 'Test 1 manifest.xlsx'),
('AION_T1_020', 1, NULL, 89.0, 92.0, 'Test 1 manifest.xlsx'),
('AION_T1_021', 1, NULL, 36.0, 40.0, 'Test 1 manifest.xlsx'),
('AION_T1_022', 1, NULL, 0.0, 0.0, 'Test 1 manifest.xlsx'),
('AION_T1_023', 1, NULL, 72.0, 76.0, 'Test 1 manifest.xlsx'),
('AION_T1_023', 2, NULL, 91.0, 92.0, 'Test 1 manifest.xlsx'),
('AION_T1_024', 1, NULL, 47.0, 51.0, 'Test 1 manifest.xlsx');
CREATE OR REPLACE FUNCTION public.start_or_resume_assessment(p_participant_id text, p_session_number integer)
 RETURNS TABLE(video_id text, video_order integer, next_video_order integer, queue_length integer, study_mode text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  normalized_mode text;
  baseline_condition text;
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
  baseline_condition := case when p_participant_id ~ '^P(2[1-9]|3[0-9]|40)$' then 'on' else 'off' end;
  if pg_catalog.length(pg_catalog.btrim(coalesce(p_participant_id, ''))) = 0 then
    raise exception 'participant_id is required';
  end if;

  if p_session_number is null or p_session_number not between 1 and 3 then
    raise exception 'session_number must be 1, 2, or 3';
  end if;

  select c.study_mode
  into normalized_mode
  from public.assessment_runtime_config c
  where c.id = 1;

  if not found then
    raise exception 'assessment runtime configuration is missing';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      p_participant_id || ':' || p_session_number::text,
      0
    )
  );

  select pg_catalog.count(*)::integer
  into eligible_video_count
  from public.videos v
  where (normalized_mode = 'dev' and v.is_test is true)
     or (
       normalized_mode = 'formal'
       and v.is_test is false
       and v.session_pool = p_session_number
           and (p_session_number <> 1 or v.ai_condition = baseline_condition)
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
           and (p_session_number <> 1 or v.ai_condition = baseline_condition)
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
           and (p_session_number <> 1 or v.ai_condition = baseline_condition)
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
           and (p_session_number <> 1 or v.ai_condition = baseline_condition)
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
$function$;
RESET ROLE;

DO $verify$ DECLARE t text; actual text; expected text; BEGIN
  FOREACH t IN ARRAY ARRAY['videos','assessment_queue','responses','lesion_detection_events','participant_session_schedule'] LOOP
    EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(r)::text,E''\n'' ORDER BY to_jsonb(r)::text),'''')) FROM public.%I r %s',t,
      CASE WHEN t='videos' THEN 'WHERE video_id NOT LIKE ''AION_T1_%''' ELSE '' END) INTO actual;
    SELECT digest INTO STRICT expected FROM aion_before WHERE name=t;
    IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Existing data changed in %', t; END IF;
  END LOOP;
  IF (SELECT count(*) FROM public.videos WHERE ai_condition='on') <> 40 OR (SELECT count(*) FROM public.video_lesions) <> 35 THEN
    RAISE EXCEPTION 'AI-ON count mismatch';
  END IF;
  IF EXISTS(SELECT 1 FROM public.videos v WHERE v.ai_condition='on' AND v.has_lesion IS DISTINCT FROM EXISTS(SELECT 1 FROM public.video_lesions l WHERE l.video_id=v.video_id)) THEN
    RAISE EXCEPTION 'Video lesion consistency mismatch';
  END IF;
  IF has_table_privilege('deskilling_app','public.video_lesions','SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'Gold standard must not be accessible by application role';
  END IF;
END $verify$;
COMMIT;
