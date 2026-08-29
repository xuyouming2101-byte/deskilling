import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  evaluateSnapshotRows,
  parseSnapshotNdjson
} from "./validate-lightweight-snapshot.mjs";

const requiredVideoColumns = [
  "video_id",
  "bucket",
  "file_path",
  "has_lesion",
  "lesion_onset_sec",
  "is_test",
  "session_pool"
];

const requiredColumnsByTable = {
  assessment_queue: [
    "id",
    "participant_id",
    "session_number",
    "video_id",
    "video_order",
    "created_at"
  ],
  responses: [
    "id",
    "participant_id",
    "session_number",
    "video_id",
    "video_order",
    "answer",
    "correct",
    "response_time_ms",
    "created_at",
    "video_time_at_click",
    "detection_latency_ms",
    "response_type",
    "video_completed",
    "no_response_latency_ms"
  ],
  lesion_detection_events: [
    "id",
    "participant_id",
    "session_number",
    "video_id",
    "video_order",
    "click_index",
    "video_time_at_click",
    "response_time_ms",
    "lesion_onset_sec",
    "detection_latency_ms",
    "overridden",
    "final_valid",
    "created_at"
  ],
  assessment_runtime_config: ["id", "study_mode"]
};

function column(tableName, columnName, dataType = "text", nullable = "NO") {
  return {
    table_name: tableName,
    ordinal_position: 1,
    column_name: columnName,
    data_type: dataType,
    udt_name: dataType,
    is_nullable: nullable,
    column_default: null,
    is_identity: "NO",
    identity_generation: null
  };
}

function readyRows() {
  const columns = [
    ...requiredVideoColumns.map((name) => column("videos", name)),
    ...Object.entries(requiredColumnsByTable).flatMap(([tableName, names]) =>
      names.map((name) => column(tableName, name))
    )
  ];

  return [
    {
      section: "guard",
      payload: { transaction_read_only: "on", database_writes_performed: 0 }
    },
    { section: "table_columns", payload: columns },
    { section: "response_event_checks", payload: [] },
    { section: "runtime_config", payload: [{ id: 1, study_mode: "dev" }] },
    {
      section: "video_pool_counts",
      payload: [{ is_test: true, session_pool: null, video_count: 20 }]
    },
    {
      section: "rpc_signatures",
      payload: [
        "start_or_resume_assessment",
        "submit_video_response",
        "get_next_video_order",
        "authorize_current_assessment_video"
      ].map((functionName) => ({
        function_name: functionName,
        state: functionName === "get_next_video_order" ? "missing" : "present",
        signatures: functionName === "get_next_video_order"
          ? []
          : [{ identity_arguments: "text, integer", result: "record", returns_set: true }]
      }))
    }
  ];
}

test("accepts a complete read-only lightweight snapshot", () => {
  const result = evaluateSnapshotRows(readyRows());

  assert.equal(result.status, "LOCAL_SEMANTICS_SNAPSHOT_READY");
  assert.equal(result.database_writes_performed, 0);
  assert.deepEqual(result.unknown, []);
});

test("marks a missing runtime configuration as incomplete", () => {
  const rows = readyRows().filter((row) => row.section !== "runtime_config");
  const result = evaluateSnapshotRows(rows);

  assert.equal(result.status, "LIGHTWEIGHT_LIVE_SNAPSHOT_INCOMPLETE");
  assert.ok(result.unknown.includes("section:runtime_config"));
});

test("rejects a snapshot not protected by a read-only transaction", () => {
  const rows = readyRows();
  rows[0] = {
    section: "guard",
    payload: { transaction_read_only: "off", database_writes_performed: 0 }
  };

  assert.throws(() => evaluateSnapshotRows(rows), /read-only transaction/i);
});

test("rejects participant values, response values, credentials, and signed URLs", () => {
  for (const forbiddenRow of [
    { section: "participant_rows", payload: [{ participant_id: "P001" }] },
    { section: "response_values", payload: [{ answer: true }] },
    { section: "credentials", payload: [{ access_token: "header.payload.signature" }] },
    { section: "video_urls", payload: [{ signed_url: "https://example.invalid/token" }] }
  ]) {
    assert.throws(
      () => evaluateSnapshotRows([...readyRows(), forbiddenRow]),
      /forbidden snapshot data/i
    );
  }
});

test("parses one JSON object per NDJSON line", () => {
  const rows = readyRows();
  const serialized = `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;

  assert.deepEqual(parseSnapshotNdjson(serialized), rows);
});

test("keeps the SQL collector read-only and narrowly scoped", async () => {
  const sql = await readFile(
    new URL("./lightweight-live-snapshot.sql", import.meta.url),
    "utf8"
  );

  assert.match(sql, /begin transaction read only;/i);
  assert.match(sql, /rollback;/i);
  assert.match(sql, /database_writes_performed/i);
  assert.doesNotMatch(sql, /pg_catalog\.coalesce/i);
  assert.doesNotMatch(
    sql,
    /\b(?:insert|update|delete|alter|create|drop|truncate|merge|grant|revoke|call|copy)\b/i
  );
  assert.doesNotMatch(sql, /supabase_migrations|pg_policy|pg_indexes|storage\./i);
  assert.doesNotMatch(sql, /select\s+[^;]*\b(?:answer|correct|has_lesion|lesion_onset_sec)\b\s+from\s+public\./i);
});
