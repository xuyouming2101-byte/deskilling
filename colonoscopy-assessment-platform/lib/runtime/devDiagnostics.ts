import { readFile } from "node:fs/promises";
import path from "node:path";
import type { DeploymentMode } from "./deploymentMode.ts";

export async function readDevDiagnosticsGate(
  deploymentMode: DeploymentMode
): Promise<boolean> {
  if (
    deploymentMode !== "local" ||
    process.env.ASSESSMENT_DEV_DIAGNOSTICS !== "1"
  ) {
    return false;
  }

  const packagePath = process.env.LOCAL_STUDY_PACKAGE_PATH;

  if (!packagePath || !path.isAbsolute(packagePath)) {
    return false;
  }

  try {
    const parsed = JSON.parse(await readFile(packagePath, "utf8")) as unknown;

    return (
      typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed) &&
      "studyMode" in parsed &&
      parsed.studyMode === "dev"
    );
  } catch {
    return false;
  }
}
