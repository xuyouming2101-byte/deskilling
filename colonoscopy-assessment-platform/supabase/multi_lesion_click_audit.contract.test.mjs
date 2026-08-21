import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sqlFiles = [
  new URL("./multi_lesion_click_audit.sql", import.meta.url),
  new URL("./schema.sql", import.meta.url)
];

const finalSessionSqlFiles = [
  new URL("./assessment_enrollment_hardening.sql", import.meta.url),
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

test("requires a protected active enrollment in the authoritative study mode", async () => {
  const sources = await Promise.all(
    finalSessionSqlFiles.map(async (file) => ({
      name: file.pathname,
      sql: await readFile(file, "utf8")
    }))
  );

  for (const { name, sql } of sources) {
    assert.match(
      sql,
      /create table if not exists public\.assessment_enrollments/i,
      name
    );
    assert.match(
      sql,
      /access_code_digest bytea not null check \(pg_catalog\.octet_length\(access_code_digest\) = 32\)/i,
      name
    );
    assert.match(sql, /active boolean not null default true/i, name);
    assert.match(
      sql,
      /study_mode text not null check \(study_mode in \('dev', 'formal'\)\)/i,
      name
    );
    assert.match(
      sql,
      /primary key \(participant_id, session_number\)/i,
      name
    );
    assert.match(
      sql,
      /revoke all on table public\.assessment_enrollments\s+from public, anon, authenticated;/i,
      name
    );
    assert.match(sql, /e\.active is true/i, name);
    assert.match(
      sql,
      /e\.study_mode = normalized_mode/i,
      name
    );
    assert.match(
      sql,
      /extensions\.digest\(p_access_code, 'sha256'\)/i,
      name
    );
    assert.match(
      sql,
      /pg_catalog\.length\(coalesce\(p_access_code, ''\)\) < 20/i,
      name
    );
    assert.match(sql, /assessment credentials are invalid/i, name);
    assert.doesNotMatch(sql, /p_access_token/i, name);
    const finalFunctions = sql.slice(
      sql.indexOf("create or replace function public.start_or_resume_assessment")
    );
    assert.doesNotMatch(finalFunctions, /access_token_digest/i, name);
    assert.match(
      sql,
      /start_or_resume_assessment\(\s*p_participant_id text,\s*p_session_number integer,\s*p_access_code text\s*\)[\s\S]*?returns table \(\s*video_id text,\s*video_order integer,\s*next_video_order integer,\s*queue_length integer,\s*study_mode text\s*\)/is,
      name
    );
  }
});

test("backfills only enrollment-matched access bindings before enforcing mode constraints", async () => {
  const migration = await readFile(
    new URL("./assessment_enrollment_hardening.sql", import.meta.url),
    "utf8"
  );

  const backfillIndex = migration.indexOf(
    "update public.assessment_session_access a"
  );
  const cleanupIndex = migration.indexOf(
    "delete from public.assessment_session_access a"
  );
  const notNullIndex = migration.indexOf(
    "alter column access_code_digest set not null"
  );

  assert.ok(backfillIndex >= 0);
  assert.ok(cleanupIndex > backfillIndex);
  assert.ok(notNullIndex > cleanupIndex);
  assert.match(
    migration,
    /a\.access_token_digest = e\.access_code_digest[\s\S]*?e\.active is true/i
  );
  assert.match(
    migration,
    /delete from public\.assessment_session_access a\s+where a\.access_code_digest is null\s+or a\.study_mode is null;/i
  );
  assert.match(migration, /legacy_access_queue_count/i);
  assert.match(migration, /legacy_access_distinct_video_count/i);
  assert.match(migration, /legacy_access_distinct_order_count/i);
  assert.match(migration, /legacy_access_min_video_order/i);
  assert.match(migration, /legacy_access_max_video_order/i);
  assert.match(
    migration,
    /legacy_access_queue_count <> \(\s*select pg_catalog\.count\(\*\)::integer\s+from public\.videos v/is
  );
  assert.match(
    migration,
    /a\.study_mode = 'formal' and legacy_access_queue_count <> 40/i
  );
  assert.match(
    migration,
    /left join public\.videos v on v\.video_id = q\.video_id[\s\S]*?v\.video_id is null/is
  );
  assert.match(
    migration,
    /add constraint assessment_session_access_study_mode_check\s+check \(study_mode in \('dev', 'formal'\)\)/i
  );
  assert.match(
    migration,
    /foreign key \(participant_id, session_number, access_code_digest, study_mode\)[\s\S]*?references public\.assessment_enrollments/i
  );
});

test("drops same-signature RPCs before changing their names or return shape", async () => {
  const sources = await Promise.all(
    finalSessionSqlFiles.map(async (file) => ({
      name: file.pathname,
      sql: await readFile(file, "utf8")
    }))
  );

  for (const { name, sql } of sources) {
    const dropStart = sql.indexOf(
      "drop function if exists public.start_or_resume_assessment(text, integer, text);"
    );
    const createStart = sql.indexOf(
      "create or replace function public.start_or_resume_assessment("
    );
    const dropSubmit = sql.indexOf(
      "drop function if exists public.submit_video_response(\n  text,\n  integer,\n  text,\n  integer,\n  boolean,\n  bigint,\n  bigint,\n  boolean,\n  jsonb,\n  text\n);"
    );
    const createSubmit = sql.lastIndexOf(
      "create or replace function public.submit_video_response("
    );

    assert.ok(dropStart >= 0 && dropStart < createStart, name);
    assert.ok(dropSubmit >= 0 && dropSubmit < createSubmit, name);
  }
});

test("preserves runtime mode, queues, responses, and event data during hardening", async () => {
  const migration = await readFile(
    new URL("./assessment_enrollment_hardening.sql", import.meta.url),
    "utf8"
  );
  const schema = await readFile(new URL("./schema.sql", import.meta.url), "utf8");

  assert.doesNotMatch(
    migration,
    /(?:insert into|update|delete from) public\.assessment_runtime_config/i
  );
  assert.doesNotMatch(
    migration,
    /(?:update|delete from) public\.(?:assessment_queue|responses|lesion_detection_events)/i
  );
  assert.match(
    schema,
    /insert into public\.assessment_runtime_config \(id, study_mode\)\s+values \(1, 'dev'\)\s+on conflict \(id\) do nothing;/i
  );
});

test("claims a legacy queue only when it exactly matches the eligible pool and order", async () => {
  const sources = await Promise.all(
    [
      ...finalSessionSqlFiles
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

test("makes access-code submissions ordered, mode-bound, and idempotent", async () => {
  const sources = await Promise.all(
    finalSessionSqlFiles.map(async (file) => ({
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
      /p_access_code text/i,
      name
    );
    assert.match(sql, /stored_mode is distinct from normalized_mode/i, name);
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
      /grant execute on function public\.submit_video_response\([\s\S]*?text\s*\) to anon;/is,
      name
    );
  }
});

test("authorizes only the current unanswered video through a service-role RPC", async () => {
  const sources = await Promise.all(
    finalSessionSqlFiles.map(async (file) => ({
      name: file.pathname,
      sql: await readFile(file, "utf8")
    }))
  );

  for (const { name, sql } of sources) {
    assert.match(
      sql,
      /create or replace function public\.authorize_current_assessment_video\(\s*p_participant_id text,\s*p_session_number integer,\s*p_video_order integer,\s*p_access_code text\s*\)/is,
      name
    );
    assert.match(
      sql,
      /returns table \(\s*bucket text,\s*file_path text\s*\)/is,
      name
    );
    assert.match(
      sql,
      /select pg_catalog\.min\(q\.video_order\)[\s\S]*?not exists \([\s\S]*?from public\.responses r/is,
      name
    );
    assert.match(
      sql,
      /if current_video_order is null or p_video_order <> current_video_order then\s+raise exception 'assessment video is not available';/is,
      name
    );
    assert.match(
      sql,
      /revoke all on function public\.authorize_current_assessment_video\(\s*text,\s*integer,\s*integer,\s*text\s*\)\s+from public, anon, authenticated;/i,
      name
    );
    assert.match(
      sql,
      /grant execute on function public\.authorize_current_assessment_video\(\s*text,\s*integer,\s*integer,\s*text\s*\)\s+to service_role;/i,
      name
    );
    assert.doesNotMatch(
      sql,
      /grant execute on function public\.authorize_current_assessment_video\([^;]+to anon;/i,
      name
    );
  }
});

test("removes anonymous Storage reads and the global video-object helper", async () => {
  const sources = await Promise.all(
    finalSessionSqlFiles.map(async (file) => ({
      name: file.pathname,
      sql: await readFile(file, "utf8")
    }))
  );

  for (const { name, sql } of sources) {
    assert.match(
      sql,
      /drop policy if exists "Allow anonymous signed URL reads for video objects"\s+on storage\.objects;/i,
      name
    );
    assert.match(
      sql,
      /drop function if exists public\.can_read_assessment_video_object\(text, text\);/i,
      name
    );
    assert.doesNotMatch(
      sql,
      /create policy[\s\S]*?on storage\.objects[\s\S]*?to anon/i,
      name
    );
    assert.doesNotMatch(
      sql,
      /create or replace function public\.can_read_assessment_video_object/i,
      name
    );
    assert.doesNotMatch(
      sql,
      /grant execute on function public\.can_read_assessment_video_object/i,
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
      file: new URL("./assessment_enrollment_hardening.sql", import.meta.url),
      expectedBodyCount: 3
    },
    {
      file: new URL("./schema.sql", import.meta.url),
      expectedBodyCount: 4
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

test("parenthesizes CASE expressions used as idempotency comparison values", async () => {
  const sources = await Promise.all(
    [
      ...finalSessionSqlFiles
    ].map(async (file) => ({
      name: file.pathname,
      sql: await readFile(file, "utf8")
    }))
  );

  const comparisons = [
    {
      column: "video_time_at_click",
      operator: "is not distinct from"
    },
    {
      column: "detection_latency_ms",
      operator: "is not distinct from"
    },
    {
      column: "response_type",
      operator: "="
    },
    {
      column: "no_response_latency_ms",
      operator: "is not distinct from"
    }
  ];

  for (const { name, sql } of sources) {
    for (const { column, operator } of comparisons) {
      const escapedOperator = operator.replaceAll(" ", "\\s+");

      assert.match(
        sql,
        new RegExp(
          `existing(?:_response)?\\.${column}\\s+${escapedOperator}\\s+\\(case\\s+when\\s+p_answer[\\s\\S]*?end\\)`,
          "i"
        ),
        `${name}: ${column}`
      );
      assert.doesNotMatch(
        sql,
        new RegExp(
          `existing(?:_response)?\\.${column}\\s+${escapedOperator}\\s+case\\b`,
          "i"
        ),
        `${name}: ${column}`
      );
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
