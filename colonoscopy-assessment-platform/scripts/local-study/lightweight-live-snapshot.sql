begin transaction read only;

set local statement_timeout = '30s';
set local lock_timeout = '5s';
set local idle_in_transaction_session_timeout = '30s';

with
target_tables(table_name) as (
  values
    ('videos'::text),
    ('assessment_queue'::text),
    ('responses'::text),
    ('lesion_detection_events'::text),
    ('assessment_runtime_config'::text)
),
column_snapshot as (
  select
    c.table_name,
    c.ordinal_position,
    c.column_name,
    c.data_type,
    c.udt_name,
    c.is_nullable,
    c.column_default,
    c.is_identity,
    c.identity_generation
  from information_schema.columns c
  join target_tables t on t.table_name = c.table_name
  where c.table_schema = 'public'
  order by c.table_name, c.ordinal_position
),
check_snapshot as (
  select
    cls.relname as table_name,
    con.conname as constraint_name,
    pg_catalog.pg_get_constraintdef(con.oid, true) as definition
  from pg_catalog.pg_constraint con
  join pg_catalog.pg_class cls on cls.oid = con.conrelid
  join pg_catalog.pg_namespace ns on ns.oid = cls.relnamespace
  where ns.nspname = 'public'
    and cls.relname in ('responses', 'lesion_detection_events')
    and con.contype = 'c'
  order by cls.relname, con.conname
),
expected_rpc(function_name) as (
  values
    ('start_or_resume_assessment'::text),
    ('submit_video_response'::text),
    ('get_next_video_order'::text),
    ('authorize_current_assessment_video'::text)
),
rpc_snapshot as (
  select
    expected.function_name,
    case when pg_catalog.count(proc.oid) = 0 then 'missing' else 'present' end as state,
    coalesce(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'identity_arguments', pg_catalog.pg_get_function_identity_arguments(proc.oid),
          'result', pg_catalog.pg_get_function_result(proc.oid),
          'returns_set', proc.proretset
        ) order by pg_catalog.pg_get_function_identity_arguments(proc.oid)
      ) filter (where proc.oid is not null),
      '[]'::jsonb
    ) as signatures
  from expected_rpc expected
  left join pg_catalog.pg_namespace ns on ns.nspname = 'public'
  left join pg_catalog.pg_proc proc
    on proc.pronamespace = ns.oid
   and proc.proname = expected.function_name
  group by expected.function_name
  order by expected.function_name
),
pool_snapshot as (
  select
    v.is_test,
    v.session_pool,
    pg_catalog.count(*)::bigint as video_count
  from public.videos v
  group by v.is_test, v.session_pool
  order by v.is_test, v.session_pool nulls first
),
snapshot_rows as (
  select 1 as section_order, pg_catalog.jsonb_build_object(
    'section', 'guard',
    'payload', pg_catalog.jsonb_build_object(
      'transaction_read_only', pg_catalog.current_setting('transaction_read_only'),
      'database_writes_performed', 0
    )
  ) as snapshot_row
  union all
  select 2, pg_catalog.jsonb_build_object(
    'section', 'table_columns',
    'payload', coalesce(
      (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(columns) order by columns.table_name, columns.ordinal_position)
       from column_snapshot columns),
      '[]'::jsonb
    )
  )
  union all
  select 3, pg_catalog.jsonb_build_object(
    'section', 'response_event_checks',
    'payload', coalesce(
      (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(checks) order by checks.table_name, checks.constraint_name)
       from check_snapshot checks),
      '[]'::jsonb
    )
  )
  union all
  select 4, pg_catalog.jsonb_build_object(
    'section', 'runtime_config',
    'payload', coalesce(
      (select pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('id', config.id, 'study_mode', config.study_mode)
        order by config.id
      ) from public.assessment_runtime_config config),
      '[]'::jsonb
    )
  )
  union all
  select 5, pg_catalog.jsonb_build_object(
    'section', 'video_pool_counts',
    'payload', coalesce(
      (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(pools) order by pools.is_test, pools.session_pool nulls first)
       from pool_snapshot pools),
      '[]'::jsonb
    )
  )
  union all
  select 6, pg_catalog.jsonb_build_object(
    'section', 'rpc_signatures',
    'payload', coalesce(
      (select pg_catalog.jsonb_agg(pg_catalog.to_jsonb(rpcs) order by rpcs.function_name)
       from rpc_snapshot rpcs),
      '[]'::jsonb
    )
  )
)
select snapshot_row
from snapshot_rows
order by section_order;

rollback;
