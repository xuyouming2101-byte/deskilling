-- Extend the password roster; AI-ON is restricted to Session 1.
-- Run only after backup and isolated restore rehearsal. Unexpected state fails closed.
BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';
SET LOCAL TIME ZONE 'UTC';
LOCK TABLE public.videos, public.video_lesions, public.assessment_queue,
  public.responses, public.lesion_detection_events,
  public.participant_session_schedule, public.assessment_runtime_config
  IN SHARE ROW EXCLUSIVE MODE;
DO $guard$
BEGIN
  IF md5(pg_get_functiondef('public.claim_participant_session_access(text,integer)'::regprocedure)) <> 'f2af9ebc05e807f4f4df03c8fb550f84'
    OR md5(pg_get_functiondef('public.start_or_resume_assessment(text,integer)'::regprocedure)) <> '2df53401f3b746f1e9459d781554b9e3' THEN
    RAISE EXCEPTION 'Unexpected live function definition; stop';
  END IF;
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.participant_session_schedule'::regclass AND conname='participant_session_schedule_participant_check')
    IS DISTINCT FROM 'CHECK ((participant_id ~ ''^P(0[1-9]|[1-5][0-9]|60)$''::text))' THEN
    RAISE EXCEPTION 'Unexpected roster constraint; stop';
  END IF;
  IF EXISTS (SELECT 1 FROM public.participant_session_schedule WHERE participant_id ~ '^P(6[1-9]|[7-9][0-9]|100)$')
    OR EXISTS (SELECT 1 FROM public.assessment_queue WHERE participant_id ~ '^P(6[1-9]|[7-9][0-9]|100)$')
    OR EXISTS (SELECT 1 FROM public.responses WHERE participant_id ~ '^P(6[1-9]|[7-9][0-9]|100)$')
    OR EXISTS (SELECT 1 FROM public.lesion_detection_events WHERE participant_id ~ '^P(6[1-9]|[7-9][0-9]|100)$') THEN
    RAISE EXCEPTION 'New participant range is not empty; stop without resetting';
  END IF;
  IF EXISTS (SELECT 1 FROM public.assessment_queue q JOIN public.videos v USING(video_id)
    WHERE q.session_number > 1 AND v.ai_condition IS DISTINCT FROM 'off') THEN
    RAISE EXCEPTION 'Existing later-session queue conflicts with OFF-only policy';
  END IF;
END $guard$;

CREATE TEMP TABLE roster_before (name text PRIMARY KEY, digest text) ON COMMIT DROP;
DO $snapshot$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['videos','video_lesions','assessment_queue','responses','lesion_detection_events','participant_session_schedule','assessment_runtime_config'] LOOP
    EXECUTE format('INSERT INTO roster_before SELECT %L, md5(coalesce(string_agg(to_jsonb(r)::text,E''\n'' ORDER BY to_jsonb(r)::text),'''')) FROM public.%I r',t,t);
  END LOOP;
  INSERT INTO roster_before SELECT 'function_permissions',md5(string_agg(proname||proowner::text||coalesce(proacl::text,''),E'\n' ORDER BY proname))
    FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f';
  INSERT INTO roster_before SELECT 'other_functions',md5(string_agg(pg_get_functiondef(oid),E'\n' ORDER BY proname))
    FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f'
      AND proname NOT IN ('claim_participant_session_access','start_or_resume_assessment');
END $snapshot$;

SET LOCAL ROLE deskilling_owner;
ALTER TABLE public.participant_session_schedule DROP CONSTRAINT participant_session_schedule_participant_check;
ALTER TABLE public.participant_session_schedule ADD CONSTRAINT participant_session_schedule_participant_check
  CHECK (participant_id ~ '^P(0[1-9]|[1-9][0-9]|100)$');
INSERT INTO public.participant_session_schedule(participant_id,session_number)
  SELECT 'P'||n::text,s FROM generate_series(61,100) n CROSS JOIN generate_series(1,3) s;

-- Derive from the hash-verified current definitions, retaining every other rule.
DO $functions$ DECLARE definition text; old_filter text; BEGIN
  definition := pg_get_functiondef('public.claim_participant_session_access(text,integer)'::regprocedure);
  IF position('^P(0[1-9]|[1-5][0-9]|60)$' IN definition)=0 THEN RAISE EXCEPTION 'Claim roster pattern missing'; END IF;
  EXECUTE replace(definition,'^P(0[1-9]|[1-5][0-9]|60)$','^P(0[1-9]|[1-9][0-9]|100)$');
  definition := pg_get_functiondef('public.start_or_resume_assessment(text,integer)'::regprocedure);
  definition := replace(definition,
    'baseline_condition := case when p_participant_id ~ ''^P(2[1-9]|3[0-9]|40)$'' then ''on'' else ''off'' end;',
    'baseline_condition := case when p_session_number = 1 and p_participant_id ~ ''^P(2[1-9]|3[0-9]|40|6[1-9]|[7-9][0-9]|100)$'' then ''on'' else ''off'' end;');
  old_filter := '(p_session_number <> 1 or v.ai_condition = baseline_condition)';
  IF (length(definition)-length(replace(definition,old_filter,'')))/length(old_filter) <> 4 THEN
    RAISE EXCEPTION 'Expected four exact eligibility predicates';
  END IF;
  EXECUTE replace(definition,old_filter,'v.ai_condition = baseline_condition');
END $functions$;
RESET ROLE;

DO $verify$ DECLARE t text; actual text; expected text; BEGIN
  FOREACH t IN ARRAY ARRAY['videos','video_lesions','assessment_queue','responses','lesion_detection_events','participant_session_schedule','assessment_runtime_config'] LOOP
    EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(r)::text,E''\n'' ORDER BY to_jsonb(r)::text),'''')) FROM public.%I r %s',t,
      CASE WHEN t='participant_session_schedule' THEN 'WHERE participant_id !~ ''^P(6[1-9]|[7-9][0-9]|100)$''' ELSE '' END) INTO actual;
    SELECT digest INTO STRICT expected FROM roster_before WHERE name=t;
    IF actual IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Existing data changed in %',t; END IF;
  END LOOP;
  SELECT md5(string_agg(proname||proowner::text||coalesce(proacl::text,''),E'\n' ORDER BY proname)) INTO actual FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f';
  IF actual IS DISTINCT FROM (SELECT digest FROM roster_before WHERE name='function_permissions') THEN RAISE EXCEPTION 'Function permissions changed'; END IF;
  SELECT md5(string_agg(pg_get_functiondef(oid),E'\n' ORDER BY proname)) INTO actual FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f' AND proname NOT IN ('claim_participant_session_access','start_or_resume_assessment');
  IF actual IS DISTINCT FROM (SELECT digest FROM roster_before WHERE name='other_functions') THEN RAISE EXCEPTION 'Other functions changed'; END IF;
  IF (SELECT count(*) FROM public.participant_session_schedule WHERE participant_id ~ '^P(6[1-9]|[7-9][0-9]|100)$') <> 120
    OR EXISTS(SELECT 1 FROM public.participant_session_schedule WHERE participant_id ~ '^P(6[1-9]|[7-9][0-9]|100)$' AND opens_at IS NOT NULL) THEN
    RAISE EXCEPTION 'New roster must have 120 unopened sessions';
  END IF;
END $verify$;
COMMIT;
