import "server-only";

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  CURRENT_LOCAL_SCHEMA_VERSION,
  LOCAL_SCHEMA_V1_SQL
} from "./schema.ts";

function utcNow(): string {
  return new Date().toISOString();
}

function readCurrentSchemaVersion(db: Database.Database): number {
  const migrationTable = db
    .prepare(
      "SELECT 1 AS present FROM sqlite_master WHERE type = 'table' AND name = 'local_schema_migrations'"
    )
    .get();

  if (!migrationTable) {
    return 0;
  }

  const row = db
    .prepare("SELECT COALESCE(MAX(version), 0) AS version FROM local_schema_migrations")
    .get() as { version: number };

  return row.version;
}

function assertQuickCheck(db: Database.Database): void {
  const rows = db.pragma("quick_check") as Array<Record<string, unknown>>;
  const values = rows.flatMap((row) => Object.values(row));

  if (values.length !== 1 || values[0] !== "ok") {
    throw new Error("LOCAL SQLite quick integrity check failed.");
  }
}

function configureDurability(db: Database.Database): void {
  db.pragma("foreign_keys = ON");
  db.pragma("busy_timeout = 5000");
  db.pragma("journal_mode = WAL");
  db.pragma("synchronous = FULL");
}

export function openLocalDatabase(databasePath: string): Database.Database {
  if (!path.isAbsolute(databasePath)) {
    throw new Error("LOCAL SQLite database path must be absolute.");
  }

  const parent = path.dirname(databasePath);

  if (!existsSync(parent) || !statSync(parent).isDirectory()) {
    throw new Error("LOCAL SQLite parent directory does not exist.");
  }

  if (existsSync(databasePath) && statSync(databasePath).isDirectory()) {
    throw new Error("LOCAL SQLite database path is a directory.");
  }

  let db: Database.Database | null = null;

  try {
    db = new Database(databasePath);
    assertQuickCheck(db);

    const currentVersion = readCurrentSchemaVersion(db);

    if (currentVersion > CURRENT_LOCAL_SCHEMA_VERSION) {
      throw new Error(
        `LOCAL SQLite uses newer schema version ${currentVersion}; supported version is ${CURRENT_LOCAL_SCHEMA_VERSION}.`
      );
    }

    configureDurability(db);
    return db;
  } catch (error) {
    db?.close();

    if (error instanceof Error && /newer schema version/.test(error.message)) {
      throw error;
    }

    throw new Error("LOCAL SQLite database is invalid or corrupt.", {
      cause: error
    });
  }
}

export function migrateLocalDatabase(db: Database.Database): void {
  const currentVersion = readCurrentSchemaVersion(db);

  if (currentVersion > CURRENT_LOCAL_SCHEMA_VERSION) {
    throw new Error("LOCAL SQLite database schema is newer than this app.");
  }

  if (currentVersion === CURRENT_LOCAL_SCHEMA_VERSION) {
    return;
  }

  if (currentVersion !== 0) {
    throw new Error(`Unsupported LOCAL SQLite schema version ${currentVersion}.`);
  }

  db.exec("BEGIN IMMEDIATE");

  try {
    db.exec(LOCAL_SCHEMA_V1_SQL);
    db.prepare(
      "INSERT INTO local_schema_migrations (version, applied_at) VALUES (?, ?)"
    ).run(CURRENT_LOCAL_SCHEMA_VERSION, utcNow());
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function assertLocalIntegrity(db: Database.Database): void {
  const integrityRows = db.pragma("integrity_check") as Array<
    Record<string, unknown>
  >;
  const integrityValues = integrityRows.flatMap((row) => Object.values(row));

  if (integrityValues.length !== 1 || integrityValues[0] !== "ok") {
    throw new Error("LOCAL SQLite integrity check failed.");
  }

  const foreignKeyRows = db.pragma("foreign_key_check") as Array<unknown>;

  if (foreignKeyRows.length > 0) {
    throw new Error("LOCAL SQLite foreign-key integrity check failed.");
  }
}
