import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { afterEach, mock, test } from "node:test";
import pg from "pg";
import { assessmentDatabase, AssessmentDatabaseError } from "./server/postgres.ts";

test("server-only import stays enforced outside the server condition", () => {
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', 'import "./lib/server/postgres.ts"'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /cannot be imported from a Client Component/);
});
test("module import never connects; missing URL and privileged users fail closed", async () => {
  mock.method(pg.Pool.prototype, "query", async () => assert.fail("Must not connect"));
  for (const url of [undefined, "not-a-url", "postgresql://postgres:secret@127.0.0.1/db", "postgresql://deskilling_owner:secret@127.0.0.1/db"]) {
    if (url) process.env.DATABASE_URL = url; else delete process.env.DATABASE_URL;
    await assert.rejects(assessmentDatabase.start("P60", 1), (error: unknown) => error instanceof AssessmentDatabaseError && error.status === 500);
  }
});
test("pool is reusable, max five, finite timeouts; int8 parameters are not coerced", async () => {
  process.env.DATABASE_URL = "postgresql://deskilling_app:unit-only@127.0.0.1/deskilling_unit";
  const instances: unknown[] = [];
  mock.method(pg.Pool.prototype, "query", async function(this: pg.Pool, sql: string, values: unknown[]) {
    instances.push(this);
    assert.equal(this.options.max, 5);
    assert.equal(this.options.connectionTimeoutMillis, 5000);
    assert.equal(this.options.statement_timeout, 15000);
    if (sql.includes("submit_video_response")) {
      assert.equal(values[5], Number.MAX_SAFE_INTEGER);
      assert.equal(values[6], 0); assert.equal(values[8], "[]");
    }
    return { rows: [{}] };
  });
  await assessmentDatabase.start("P60", 1);
  await assessmentDatabase.submit({ p_participant_id: "P60", p_session_number: 1, p_video_id: "T1_001", p_video_order: 1, p_answer: false, p_response_time_ms: Number.MAX_SAFE_INTEGER, p_no_response_latency_ms: 0, p_video_completed: true, p_clicks: [] });
  assert.equal(instances[0], instances[1]);
});
afterEach(() => mock.restoreAll());
