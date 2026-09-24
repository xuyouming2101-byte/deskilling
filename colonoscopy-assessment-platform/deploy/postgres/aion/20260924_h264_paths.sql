-- Apply only after all 40 uploaded H264 copies pass checksum and codec checks.
-- Original files and every non-path research field remain untouched.
BEGIN;
SET LOCAL lock_timeout='10s';
SET LOCAL statement_timeout='60s';
SET LOCAL TIME ZONE 'UTC';
LOCK TABLE public.videos, public.video_lesions, public.assessment_queue,
  public.responses, public.lesion_detection_events,
  public.participant_session_schedule, public.assessment_runtime_config
  IN SHARE ROW EXCLUSIVE MODE;
CREATE TEMP TABLE h264_mapping ON COMMIT DROP AS
  SELECT 'AION_T1_'||lpad(n::text,3,'0') AS video_id,
    'Test1/AION/videos/'||lpad(n::text,2,'0')||'_ai.mp4' AS old_path,
    'Test1/AION/H264/'||lpad(n::text,2,'0')||'_ai_h264.mp4' AS new_path
  FROM generate_series(1,40) n;
DO $guard$ BEGIN
  IF (SELECT count(*) FROM public.videos v JOIN h264_mapping m USING(video_id)
    WHERE v.file_path=m.old_path AND v.ai_condition='on' AND v.session_pool=1
      AND v.is_test=false AND v.bucket='FORMAL_ECS') <> 40 THEN
    RAISE EXCEPTION 'Expected exactly 40 original AI-ON paths; stop without partial switch';
  END IF;
END $guard$;
CREATE TEMP TABLE h264_before(name text PRIMARY KEY,digest text) ON COMMIT DROP;
DO $snapshot$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['video_lesions','assessment_queue','responses','lesion_detection_events','participant_session_schedule','assessment_runtime_config'] LOOP
    EXECUTE format('INSERT INTO h264_before SELECT %L,md5(coalesce(string_agg(to_jsonb(r)::text,E''\n'' ORDER BY to_jsonb(r)::text),'''')) FROM public.%I r',t,t);
  END LOOP;
  INSERT INTO h264_before SELECT 'videos',md5(string_agg(
    (CASE WHEN m.video_id IS NOT NULL THEN to_jsonb(v)-'file_path' ELSE to_jsonb(v) END)::text,E'\n' ORDER BY v.video_id))
    FROM public.videos v LEFT JOIN h264_mapping m USING(video_id);
  INSERT INTO h264_before SELECT 'functions',md5(string_agg(pg_get_functiondef(oid)||proowner::text||coalesce(proacl::text,''),E'\n' ORDER BY proname))
    FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f';
END $snapshot$;
DO $update$ DECLARE changed integer; BEGIN
  UPDATE public.videos v SET file_path=m.new_path FROM h264_mapping m WHERE v.video_id=m.video_id;
  GET DIAGNOSTICS changed=ROW_COUNT;
  IF changed<>40 THEN RAISE EXCEPTION 'Expected 40 updates, got %',changed; END IF;
END $update$;
DO $verify$ DECLARE t text; actual text; BEGIN
  FOREACH t IN ARRAY ARRAY['video_lesions','assessment_queue','responses','lesion_detection_events','participant_session_schedule','assessment_runtime_config'] LOOP
    EXECUTE format('SELECT md5(coalesce(string_agg(to_jsonb(r)::text,E''\n'' ORDER BY to_jsonb(r)::text),'''')) FROM public.%I r',t) INTO actual;
    IF actual IS DISTINCT FROM (SELECT digest FROM h264_before WHERE name=t) THEN RAISE EXCEPTION 'Unexpected change to %',t; END IF;
  END LOOP;
  SELECT md5(string_agg((CASE WHEN m.video_id IS NOT NULL THEN to_jsonb(v)-'file_path' ELSE to_jsonb(v) END)::text,E'\n' ORDER BY v.video_id)) INTO actual
    FROM public.videos v LEFT JOIN h264_mapping m USING(video_id);
  IF actual IS DISTINCT FROM (SELECT digest FROM h264_before WHERE name='videos') THEN RAISE EXCEPTION 'Non-path video data changed'; END IF;
  SELECT md5(string_agg(pg_get_functiondef(oid)||proowner::text||coalesce(proacl::text,''),E'\n' ORDER BY proname)) INTO actual
    FROM pg_proc WHERE pronamespace='public'::regnamespace AND prokind='f';
  IF actual IS DISTINCT FROM (SELECT digest FROM h264_before WHERE name='functions') THEN RAISE EXCEPTION 'Functions changed'; END IF;
  IF (SELECT count(*) FROM public.videos v JOIN h264_mapping m USING(video_id) WHERE v.file_path=m.new_path)<>40 THEN RAISE EXCEPTION 'Incomplete H264 switch'; END IF;
END $verify$;
COMMIT;
