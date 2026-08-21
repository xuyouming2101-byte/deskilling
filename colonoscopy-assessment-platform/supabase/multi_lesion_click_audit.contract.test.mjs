import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sqlFiles = [
  new URL("./multi_lesion_click_audit.sql", import.meta.url),
  new URL("./schema.sql", import.meta.url)
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
      /revoke all on function public\.submit_video_response\([\s\S]*?\) from public;/,
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
