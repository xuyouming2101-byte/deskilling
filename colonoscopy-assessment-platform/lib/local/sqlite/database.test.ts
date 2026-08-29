import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "server-only") {
      return {
        shortCircuit: true,
        url: "data:text/javascript,export%20{}"
      };
    }

    return nextResolve(specifier, context);
  }
});

const {
  assertLocalIntegrity,
  migrateLocalDatabase,
  openLocalDatabase
} = await import("./database.ts");
const { CURRENT_LOCAL_SCHEMA_VERSION } = await import("./schema.ts");

async function withTempDirectory(
  run: (directory: string) => Promise<void> | void
) {
  const directory = await mkdtemp(path.join(tmpdir(), "deskilling-sqlite-"));

  try {
    await run(directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("pins and externalizes the native SQLite runtime", () => {
  const packageJson = JSON.parse(
    readFileSync(new URL("../../../package.json", import.meta.url), "utf8")
  );
  const nextConfig = readFileSync(
    new URL("../../../next.config.mjs", import.meta.url),
    "utf8"
  );

  assert.equal(packageJson.dependencies["better-sqlite3"], "13.0.3");
  assert.equal(packageJson.dependencies.canonicalize, "4.0.0");
  assert.equal(
    packageJson.devDependencies["@types/better-sqlite3"],
    "9.6.0"
  );
  assert.match(
    nextConfig,
    /serverExternalPackages:\s*\["better-sqlite3"\]/
  );
});

test("blocks a missing parent directory and a directory database path", async () => {
  await withTempDirectory(async (directory) => {
    assert.throws(
      () => openLocalDatabase(path.join(directory, "missing", "data.sqlite")),
      /parent directory does not exist/
    );

    const directoryPath = path.join(directory, "database.sqlite");
    await mkdir(directoryPath);
    assert.throws(
      () => openLocalDatabase(directoryPath),
      /database path is a directory/
    );
  });
});

test("does not truncate or replace a corrupt existing database", async () => {
  await withTempDirectory(async (directory) => {
    const databasePath = path.join(directory, "corrupt.sqlite");
    const original = Buffer.from("not-a-sqlite-database");
    await writeFile(databasePath, original);

    assert.throws(() => openLocalDatabase(databasePath), /invalid or corrupt/i);
    assert.deepEqual(await readFile(databasePath), original);
  });
});

test("rejects a future schema version without changing the file", async () => {
  await withTempDirectory(async (directory) => {
    const databasePath = path.join(directory, "future.sqlite");
    const raw = new Database(databasePath);
    raw.exec(
      "CREATE TABLE local_schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)"
    );
    raw
      .prepare(
        "INSERT INTO local_schema_migrations (version, applied_at) VALUES (?, ?)"
      )
      .run(CURRENT_LOCAL_SCHEMA_VERSION + 1, "2026-08-29T00:00:00.000Z");
    raw.close();
    const before = await readFile(databasePath);

    assert.throws(() => openLocalDatabase(databasePath), /newer schema version/);
    assert.deepEqual(await readFile(databasePath), before);
  });
});

test("configures durable pragmas and creates schema version 1 transactionally", async () => {
  await withTempDirectory(async (directory) => {
    const databasePath = path.join(directory, "assessment.sqlite");
    const db = openLocalDatabase(databasePath);

    migrateLocalDatabase(db);

    assert.equal(db.pragma("foreign_keys", { simple: true }), 1);
    assert.equal(db.pragma("journal_mode", { simple: true }), "wal");
    assert.equal(db.pragma("synchronous", { simple: true }), 2);
    assert.equal(db.pragma("busy_timeout", { simple: true }), 5000);

    const tables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'local_%' ORDER BY name"
      )
      .all()
      .map((row) => (row as { name: string }).name);

    assert.deepEqual(tables, [
      "local_assessment_attempts",
      "local_assessment_queue",
      "local_lesion_detection_events",
      "local_responses",
      "local_schema_migrations",
      "local_study_packages",
      "local_sync_log",
      "local_video_metadata_snapshot"
    ]);
    assert.equal(
      (
        db
          .prepare("SELECT MAX(version) AS version FROM local_schema_migrations")
          .get() as { version: number }
      ).version,
      CURRENT_LOCAL_SCHEMA_VERSION
    );
    assertLocalIntegrity(db);
    db.close();
  });
});

test("rolls back every schema object when migration fails", async () => {
  await withTempDirectory(async (directory) => {
    const databasePath = path.join(directory, "failed-migration.sqlite");
    const db = openLocalDatabase(databasePath);
    db.exec("CREATE VIEW local_responses AS SELECT 1 AS incompatible");

    assert.throws(() => migrateLocalDatabase(db));

    const createdTables = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('local_assessment_attempts', 'local_assessment_queue')"
      )
      .all();
    assert.deepEqual(createdTables, []);
    db.close();
  });
});

test("detects foreign-key integrity failures", async () => {
  await withTempDirectory(async (directory) => {
    const db = openLocalDatabase(path.join(directory, "integrity.sqlite"));
    migrateLocalDatabase(db);
    db.pragma("foreign_keys = OFF");
    db.prepare(
      `INSERT INTO local_assessment_queue
        (attempt_id, participant_id, session_number, video_id, video_order, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      "orphan-attempt",
      "P001",
      1,
      "video_001",
      1,
      "2026-08-29T00:00:00.000Z"
    );
    db.pragma("foreign_keys = ON");

    assert.throws(() => assertLocalIntegrity(db), /foreign-key integrity/i);
    db.close();
  });
});

test("survives close and reopen with schema and WAL data intact", async () => {
  await withTempDirectory(async (directory) => {
    const databasePath = path.join(directory, "reopen.sqlite");
    const first = openLocalDatabase(databasePath);
    migrateLocalDatabase(first);
    first.prepare(
      `INSERT INTO local_study_packages
        (checksum_sha256, package_version, minimum_schema_version, study_mode,
         generated_at, allowed_participant_ids_json, canonical_manifest_json,
         registered_at)
       VALUES (?, 1, 1, 'dev', ?, '[]', '{}', ?)`
    ).run(
      "a".repeat(64),
      "2026-08-29T00:00:00.000Z",
      "2026-08-29T00:00:00.000Z"
    );
    first.close();

    const reopened = openLocalDatabase(databasePath);
    migrateLocalDatabase(reopened);
    assert.equal(
      (
        reopened
          .prepare("SELECT COUNT(*) AS count FROM local_study_packages")
          .get() as { count: number }
      ).count,
      1
    );
    assertLocalIntegrity(reopened);
    reopened.close();
  });
});
