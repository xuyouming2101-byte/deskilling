import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";
import type Database from "better-sqlite3";
import { validateLocalStudyPackage } from "./studyPackage.ts";
import {
  migrateLocalDatabase,
  openLocalDatabase
} from "./sqlite/database.ts";
import { LocalAssessmentRepository } from "./sqlite/localAssessmentRepository.ts";

type LocalRepositoryCallback<T> = (
  repository: LocalAssessmentRepository,
  db: Database.Database
) => Promise<T> | T;

function readAbsoluteEnvironmentPath(name: string): string {
  const value = process.env[name];

  if (!value || !path.isAbsolute(value)) {
    throw new Error(`${name} must be configured as an absolute path.`);
  }

  return value;
}

export async function withLocalAssessmentRepository<T>(
  requireStudyPackage: boolean,
  callback: LocalRepositoryCallback<T>
): Promise<T> {
  const databasePath = readAbsoluteEnvironmentPath("LOCAL_DATABASE_PATH");
  let studyPackage;

  if (requireStudyPackage) {
    const packagePath = readAbsoluteEnvironmentPath(
      "LOCAL_STUDY_PACKAGE_PATH"
    );
    const videoRoot = readAbsoluteEnvironmentPath("LOCAL_VIDEO_ROOT");
    const packageText = await readFile(packagePath, "utf8");
    let packageInput: unknown;

    try {
      packageInput = JSON.parse(packageText);
    } catch (error) {
      throw new Error("LOCAL study package is not valid JSON.", {
        cause: error
      });
    }

    studyPackage = await validateLocalStudyPackage(packageInput, videoRoot);
  }

  const db = openLocalDatabase(databasePath);

  try {
    migrateLocalDatabase(db);
    const repository = new LocalAssessmentRepository(db, { studyPackage });
    return await callback(repository, db);
  } finally {
    db.close();
  }
}
