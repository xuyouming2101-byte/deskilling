import "server-only";

export type DeploymentMode = "local" | "online";

const DEPLOYMENT_MODE_ERROR =
  "ASSESSMENT_DEPLOYMENT_MODE must be exactly local or online.";

export function parseDeploymentMode(value: unknown): DeploymentMode {
  if (value === "local" || value === "online") {
    return value;
  }

  throw new Error(DEPLOYMENT_MODE_ERROR);
}

export function readDeploymentMode(
  environment: Record<string, string | undefined> = process.env
): DeploymentMode {
  return parseDeploymentMode(environment.ASSESSMENT_DEPLOYMENT_MODE);
}
