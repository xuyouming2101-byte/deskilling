import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const REQUIRED_SECTIONS = [
  "guard",
  "table_columns",
  "response_event_checks",
  "runtime_config",
  "video_pool_counts",
  "rpc_signatures"
];

const REQUIRED_COLUMNS = {
  videos: [
    "video_id",
    "bucket",
    "file_path",
    "has_lesion",
    "lesion_onset_sec",
    "is_test",
    "session_pool"
  ],
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

const EXPECTED_RPCS = [
  "start_or_resume_assessment",
  "submit_video_response",
  "get_next_video_order",
  "authorize_current_assessment_video"
];

const REQUIRED_PRESENT_RPCS = [
  "start_or_resume_assessment",
  "submit_video_response",
  "authorize_current_assessment_video"
];

const FORBIDDEN_VALUE_KEYS = new Set([
  "participant_id",
  "answer",
  "correct",
  "has_lesion",
  "lesion_onset_sec",
  "signed_url",
  "access_token",
  "refresh_token",
  "password",
  "access_code",
  "access_code_digest"
]);

function assertSafeSnapshotValue(value, path = "snapshot") {
  if (typeof value === "string") {
    if (
      /sb_(?:publishable|secret)_[A-Za-z0-9_-]+/.test(value) ||
      /eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value) ||
      /\/storage\/v1\/object\/sign\//.test(value)
    ) {
      throw new Error(`Forbidden snapshot data at ${path}.`);
    }
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSafeSnapshotValue(item, `${path}[${index}]`));
    return;
  }

  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (FORBIDDEN_VALUE_KEYS.has(key)) {
        throw new Error(`Forbidden snapshot data at ${path}.${key}.`);
      }
      assertSafeSnapshotValue(child, `${path}.${key}`);
    }
  }
}

export function parseSnapshotNdjson(source) {
  return source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      try {
        const parsed = JSON.parse(line);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("line is not a JSON object");
        }
        return parsed;
      } catch (error) {
        throw new Error(
          `Invalid NDJSON at line ${index + 1}: ${error instanceof Error ? error.message : "parse failure"}`
        );
      }
    });
}

function indexSections(rows) {
  const sections = new Map();

  for (const row of rows) {
    if (typeof row.section !== "string" || !("payload" in row)) {
      throw new Error("Each snapshot row requires section and payload.");
    }
    if (sections.has(row.section)) {
      throw new Error(`Duplicate snapshot section: ${row.section}.`);
    }
    sections.set(row.section, row.payload);
  }

  return sections;
}

function summarizeColumns(payload, unknown) {
  if (!Array.isArray(payload)) {
    unknown.push("section:table_columns:invalid");
    return {};
  }

  const tables = {};
  for (const row of payload) {
    if (
      !row ||
      typeof row !== "object" ||
      typeof row.table_name !== "string" ||
      typeof row.column_name !== "string"
    ) {
      unknown.push("section:table_columns:invalid_row");
      continue;
    }
    (tables[row.table_name] ??= []).push({
      name: row.column_name,
      dataType: row.data_type ?? null,
      udtName: row.udt_name ?? null,
      nullable: row.is_nullable ?? null,
      default: row.column_default ?? null,
      identity: row.is_identity ?? null,
      identityGeneration: row.identity_generation ?? null
    });
  }

  for (const [tableName, requiredColumns] of Object.entries(REQUIRED_COLUMNS)) {
    const observed = new Set((tables[tableName] ?? []).map((column) => column.name));
    for (const columnName of requiredColumns) {
      if (!observed.has(columnName)) {
        unknown.push(`column:${tableName}.${columnName}`);
      }
    }
  }

  return tables;
}

function summarizeRuntimeConfig(payload, unknown) {
  if (!Array.isArray(payload) || payload.length !== 1) {
    unknown.push("runtime_config:single_row");
    return { state: "unknown", studyMode: null };
  }

  const row = payload[0];
  if (row?.id !== 1 || !["dev", "formal"].includes(row?.study_mode)) {
    unknown.push("runtime_config:study_mode");
    return { state: "unknown", studyMode: null };
  }

  return { state: "present", studyMode: row.study_mode };
}

function summarizePools(payload, unknown) {
  if (!Array.isArray(payload) || payload.length === 0) {
    unknown.push("video_pool_counts:empty");
    return [];
  }

  return payload.map((row, index) => {
    const count = Number(row?.video_count);
    if (
      typeof row?.is_test !== "boolean" ||
      ![null, 1, 2, 3].includes(row?.session_pool ?? null) ||
      !Number.isSafeInteger(count) ||
      count < 0
    ) {
      unknown.push(`video_pool_counts:row_${index + 1}`);
    }
    return {
      isTest: row?.is_test ?? null,
      sessionPool: row?.session_pool ?? null,
      videoCount: Number.isSafeInteger(count) ? count : null
    };
  });
}

function summarizeRpcs(payload, unknown) {
  if (!Array.isArray(payload)) {
    unknown.push("section:rpc_signatures:invalid");
    return {};
  }

  const rpcs = {};
  for (const row of payload) {
    if (
      !row ||
      typeof row.function_name !== "string" ||
      !["present", "missing"].includes(row.state) ||
      !Array.isArray(row.signatures)
    ) {
      unknown.push("section:rpc_signatures:invalid_row");
      continue;
    }
    rpcs[row.function_name] = {
      state: row.state,
      signatures: row.signatures
    };
  }

  for (const functionName of EXPECTED_RPCS) {
    if (!rpcs[functionName]) {
      unknown.push(`rpc:${functionName}:unknown`);
    }
  }
  for (const functionName of REQUIRED_PRESENT_RPCS) {
    if (rpcs[functionName]?.state !== "present") {
      unknown.push(`rpc:${functionName}:not_present`);
    }
  }

  return rpcs;
}

export function evaluateSnapshotRows(rows) {
  assertSafeSnapshotValue(rows);
  const sections = indexSections(rows);
  const guard = sections.get("guard");

  if (
    guard?.transaction_read_only !== "on" ||
    guard?.database_writes_performed !== 0
  ) {
    throw new Error("Snapshot was not collected in a read-only transaction.");
  }

  const unknown = [];
  for (const section of REQUIRED_SECTIONS) {
    if (!sections.has(section)) {
      unknown.push(`section:${section}`);
    }
  }

  const tables = summarizeColumns(sections.get("table_columns"), unknown);
  const runtimeConfig = summarizeRuntimeConfig(sections.get("runtime_config"), unknown);
  const videoPoolCounts = summarizePools(sections.get("video_pool_counts"), unknown);
  const rpcs = summarizeRpcs(sections.get("rpc_signatures"), unknown);
  const checks = Array.isArray(sections.get("response_event_checks"))
    ? sections.get("response_event_checks")
    : [];

  return {
    status: unknown.length === 0
      ? "LOCAL_SEMANTICS_SNAPSHOT_READY"
      : "LIGHTWEIGHT_LIVE_SNAPSHOT_INCOMPLETE",
    database_writes_performed: 0,
    observed: {
      tables,
      responseEventChecks: checks,
      runtimeConfig,
      videoPoolCounts,
      rpcs
    },
    unknown: [...new Set(unknown)].sort()
  };
}

async function runCli() {
  const inputPath = process.argv[2];
  if (!inputPath) {
    throw new Error("Usage: node validate-lightweight-snapshot.mjs <snapshot.ndjson>");
  }

  const source = await readFile(inputPath, "utf8");
  const rows = parseSnapshotNdjson(source);
  const result = evaluateSnapshotRows(rows);
  const sha256 = createHash("sha256").update(source).digest("hex");

  process.stdout.write(`${JSON.stringify({ ...result, raw_snapshot_sha256: sha256 }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Snapshot validation failed."}\n`);
    process.exitCode = 1;
  });
}
