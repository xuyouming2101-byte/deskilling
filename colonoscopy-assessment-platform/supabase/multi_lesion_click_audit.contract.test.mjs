import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sqlFiles = [
  new URL("./multi_lesion_click_audit.sql", import.meta.url),
  new URL("./schema.sql", import.meta.url)
];

const verificationArtifacts = [
  new URL(
    "../docs/superpowers/plans/2026-08-21-multi-lesion-click-audit.md",
    import.meta.url
  ),
  new URL(
    "../../.superpowers/sdd/2026-08-21-multi-lesion-click-audit/task-2-brief.md",
    import.meta.url
  )
];

test("keeps response and event writes behind the trusted RPC boundary", async () => {
  const sources = await Promise.all(
    sqlFiles.map(async (file) => ({
      name: file.pathname,
      sql: await readFile(file, "utf8")
    }))
  );

  for (const { name, sql } of sources) {
    assert.match(sql, /security definer/, name);
    assert.doesNotMatch(sql, /security invoker/, name);
    assert.doesNotMatch(sql, /pg_catalog\.coalesce/, name);
    assert.match(sql, /set search_path = ''/, name);
    assert.match(
      sql,
      /revoke all on table public\.responses\s+from public, anon, authenticated;/,
      name
    );
    assert.match(
      sql,
      /revoke all on table public\.lesion_detection_events\s+from public, anon, authenticated;/,
      name
    );
    assert.match(
      sql,
      /revoke all on sequence public\.responses_id_seq\s+from public, anon, authenticated;/,
      name
    );
    assert.match(
      sql,
      /revoke all on sequence public\.lesion_detection_events_id_seq\s+from public, anon, authenticated;/,
      name
    );
    assert.doesNotMatch(
      sql,
      /grant insert on table public\.(?:responses|lesion_detection_events) to anon;/,
      name
    );
    assert.doesNotMatch(
      sql,
      /create policy "Allow anonymous (?:response|lesion event) inserts"/,
      name
    );
    assert.match(
      sql,
      /revoke all on function public\.submit_video_response\([\s\S]*?\) from public(?:, authenticated)?;/,
      name
    );
    assert.match(
      sql,
      /grant execute on function public\.submit_video_response\([\s\S]*?\) to anon;/,
      name
    );
    assert.ok(
      sql.indexOf("insert into public.lesion_detection_events") <
        sql.indexOf("insert into public.responses"),
      name
    );
  }
});

test("binds queue creation, resume, and submission to a private session token", async () => {
  const sql = await readFile(
    new URL("./session_access_hardening.sql", import.meta.url),
    "utf8"
  );

  assert.match(sql, /create table if not exists public\.assessment_session_access/i);
  assert.match(sql, /access_token_digest bytea not null/i);
  assert.match(
    sql,
    /primary key \(participant_id, session_number\)/i
  );
  assert.match(
    sql,
    /revoke all on table public\.assessment_session_access\s+from public, anon, authenticated;/i
  );
  assert.match(
    sql,
    /create or replace function public\.start_or_resume_assessment\([\s\S]*?security definer[\s\S]*?set search_path = ''/i
  );
  assert.match(sql, /pg_catalog\.pg_advisory_xact_lock/i);
  assert.match(sql, /extensions\.digest\(p_access_token, 'sha256'\)/i);
  assert.match(sql, /create table if not exists public\.assessment_runtime_config/i);
  assert.match(sql, /id integer primary key check \(id = 1\)/i);
  assert.match(sql, /study_mode text not null check \(study_mode in \('dev', 'formal'\)\)/i);
  assert.match(
    sql,
    /insert into public\.assessment_runtime_config \(id, study_mode\)\s+values \(1, 'dev'\)\s+on conflict \(id\) do nothing;/i
  );
  assert.match(sql, /from public\.assessment_runtime_config c/i);
  assert.match(sql, /legacy queue does not match configured study mode/i);
  assert.match(sql, /v\.is_test is true/i);
  assert.match(sql, /v\.is_test is false/i);
  assert.match(sql, /normalized_mode = 'dev'/i);
  assert.match(sql, /normalized_mode = 'formal'/i);
  assert.match(sql, /order by pg_catalog\.random\(\)/i);
  assert.match(sql, /'Session %s is not ready: %s\/40 formal videos configured\.'/i);
  assert.doesNotMatch(sql, /p_study_mode/i);
  assert.match(
    sql,
    /start_or_resume_assessment\(\s*p_participant_id text,\s*p_session_number integer,\s*p_access_token text\s*\)/is
  );
  assert.match(
    sql,
    /returns table \(\s*video_id text,\s*video_order integer,\s*bucket text,\s*file_path text,\s*next_video_order integer,\s*queue_length integer,\s*study_mode text\s*\)\s*language/i
  );
});

test("claims a legacy queue only when it exactly matches the eligible pool and order", async () => {
  const sources = await Promise.all(
    [
      new URL("./schema.sql", import.meta.url),
      new URL("./session_access_hardening.sql", import.meta.url)
    ].map(async (file) => ({
      name: file.pathname,
      sql: await readFile(file, "utf8")
    }))
  );

  for (const { name, sql } of sources) {
    assert.match(sql, /legacy_distinct_video_count integer;/i, name);
    assert.match(sql, /legacy_distinct_order_count integer;/i, name);
    assert.match(sql, /legacy_min_video_order integer;/i, name);
    assert.match(sql, /legacy_max_video_order integer;/i, name);
    assert.match(
      sql,
      /from public\.assessment_queue q\s+left join public\.videos v on v\.video_id = q\.video_id[\s\S]*?v\.video_id is null[\s\S]*?into queue_is_eligible_set;/i,
      name
    );
    assert.match(
      sql,
      /from public\.videos v[\s\S]*?not exists \(\s*select 1\s+from public\.assessment_queue q[\s\S]*?\)\s*\)\s*into eligible_pool_is_queued;/i,
      name
    );
    assert.match(sql, /existing_queue_length = eligible_video_count/i, name);
    assert.match(
      sql,
      /legacy_distinct_video_count = existing_queue_length/i,
      name
    );
    assert.match(
      sql,
      /legacy_distinct_order_count = existing_queue_length/i,
      name
    );
    assert.match(sql, /legacy_min_video_order = 1/i, name);
    assert.match(
      sql,
      /legacy_max_video_order = existing_queue_length/i,
      name
    );
    assert.match(
      sql,
      /normalized_mode <> 'formal'\s+or eligible_video_count = 40/i,
      name
    );
    assert.match(
      sql,
      /queue_is_eligible_set\s+and eligible_pool_is_queued/i,
      name
    );
  }
});

test("removes anonymous table reads and makes token-bound submissions ordered and idempotent", async () => {
  const sources = await Promise.all(
    [
      new URL("./schema.sql", import.meta.url),
      new URL("./session_access_hardening.sql", import.meta.url)
    ].map(async (file) => ({
      name: file.pathname,
      sql: await readFile(file, "utf8")
    }))
  );

  for (const { name, sql } of sources) {
    assert.match(
      sql,
      /revoke all on table public\.assessment_queue\s+from public, anon, authenticated;/i,
      name
    );
    assert.match(
      sql,
      /revoke all on table public\.videos\s+from public, anon, authenticated;/i,
      name
    );
    assert.doesNotMatch(sql, /create policy "Allow anonymous (?:videos|assessment queue)/i, name);
    assert.match(
      sql,
      /drop policy if exists "Allow anonymous queue insert"\s+on public\.assessment_queue;/i,
      name
    );
    assert.match(
      sql,
      /drop policy if exists "Allow anonymous queue read"\s+on public\.assessment_queue;/i,
      name
    );
    assert.match(
      sql,
      /drop policy if exists "Allow anonymous read of video metadata"\s+on public\.videos;/i,
      name
    );
    assert.match(
      sql,
      /revoke all on function public\.get_next_video_order\(text, integer\)[\s\S]*?from public, anon, authenticated;/i,
      name
    );
    assert.match(
      sql,
      /p_access_token text/i,
      name
    );
    assert.match(sql, /first unanswered queue order/i, name);
    assert.match(sql, /idempotent replay/i, name);
    assert.match(sql, /existing response differs from retry payload/i, name);
    assert.match(
      sql,
      /if p_answer is true and p_response_time_ms <> first_response_time_ms then\s+raise exception 'positive response_time_ms must equal the first lesion click response_time_ms';/is,
      name
    );
    assert.match(
      sql,
      /grant execute on function public\.start_or_resume_assessment\([\s\S]*?\) to anon;/i,
      name
    );
    assert.match(
      sql,
      /grant execute on function public\.submit_video_response\([\s\S]*?p_access_token|grant execute on function public\.submit_video_response\([\s\S]*?text\s*\) to anon;/is,
      name
    );
  }
});

test("installs pgcrypto in extensions before functions reference extensions.digest", async () => {
  const sql = await readFile(new URL("./schema.sql", import.meta.url), "utf8");

  assert.match(
    sql,
    /^create extension if not exists pgcrypto with schema extensions;/im
  );
  assert.doesNotMatch(sql, /^create extension if not exists pgcrypto;$/im);
});

test("terminates every hardening PL/pgSQL function body with end semicolon", async () => {
  const cases = [
    {
      file: new URL("./session_access_hardening.sql", import.meta.url),
      expectedBodyCount: 2
    },
    {
      file: new URL("./schema.sql", import.meta.url),
      expectedBodyCount: 3
    }
  ];

  for (const { file, expectedBodyCount } of cases) {
    const sql = await readFile(file, "utf8");
    const functionStatements =
      sql.match(/create or replace function[\s\S]*?\$\$;/gi) ?? [];
    const plpgsqlFunctions = functionStatements.filter((statement) =>
      /language plpgsql/i.test(statement)
    );

    assert.equal(plpgsqlFunctions.length, expectedBodyCount, file.pathname);

    for (const statement of plpgsqlFunctions) {
      assert.doesNotMatch(statement, /\nend\n\$\$;$/i, file.pathname);
      assert.match(statement, /\nend;\n\$\$;$/i, file.pathname);
    }
  }
});

test("uses a distinct no-click video to prove duplicate-response rollback", async () => {
  const sources = await Promise.all(
    verificationArtifacts.map(async (file) => ({
      name: file.pathname,
      text: await readFile(file, "utf8")
    }))
  );

  for (const { name, text } of sources) {
    assert.match(text, /limit 3;/, name);
    assert.match(
      text,
      /video_order = 3[\s\S]*?\n\s*3,\n\s*false,[\s\S]*?'\[\]'::jsonb/s,
      name
    );
    assert.match(text, /do \$\$[\s\S]*?when unique_violation then/s, name);
    assert.match(text, /video 3 still has zero events/i, name);
  }
});
