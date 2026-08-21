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
  assert.match(sql, /legacy DEV queue/i);
  assert.match(sql, /normalized_mode = 'dev'/i);
  assert.match(sql, /normalized_mode = 'formal'/i);
  assert.match(sql, /order by pg_catalog\.random\(\)/i);
  assert.match(sql, /'Session %s is not ready: %s\/40 formal videos configured\.'/i);
  assert.match(
    sql,
    /returns table \(\s*video_id text,\s*video_order integer,\s*bucket text,\s*file_path text,\s*next_video_order integer,\s*queue_length integer\s*\)\s*language/i
  );
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
