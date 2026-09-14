# Historical duplicate-response rollback contract fixture

This is inert historical test input, NOT a migration or an instruction to execute SQL.
The Step 5 excerpt below is verbatim from the recovered original task-2 brief.
The contract test reads it as text only. Current ECS behavior is independently
covered by the real PostgreSQL integration test.

Source: multi-lesion-click-audit worktree, historical task-2-brief.md.
Original full-file SHA256: `c50eca385beeb6041f2b96f19df12ab61a2a7a4c0c8ae03bf7a64c0b4e8ce7de`.
Only Step 5 is needed; other implementation steps and workspace instructions are excluded.

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
