import "server-only";

import type { DeploymentMode } from "../runtime/deploymentMode";
import type {
  AssessmentRepository,
  CurrentVideoAuthorizationRepository
} from "./contracts";

type ModeRepositories<T> = {
  local?: T;
  online?: T;
};

function requireModeRepository<T>(
  kind: string,
  mode: DeploymentMode,
  repositories: ModeRepositories<T>
): T {
  const repository = repositories[mode];

  if (!repository) {
    throw new Error(`No ${kind} repository is configured for ${mode} mode.`);
  }

  return repository;
}

export function createAssessmentRepository(
  mode: DeploymentMode,
  repositories: ModeRepositories<AssessmentRepository>
): AssessmentRepository {
  return requireModeRepository("assessment", mode, repositories);
}

export function createVideoAuthorizationRepository(
  mode: DeploymentMode,
  repositories: ModeRepositories<CurrentVideoAuthorizationRepository>
): CurrentVideoAuthorizationRepository {
  return requireModeRepository("video authorization", mode, repositories);
}

export function createLocalRepositoryPair<T extends AssessmentRepository & CurrentVideoAuthorizationRepository>(
  repository: T
): {
  assessmentRepository: AssessmentRepository;
  videoAuthorizationRepository: CurrentVideoAuthorizationRepository;
} {
  return {
    assessmentRepository: repository,
    videoAuthorizationRepository: repository
  };
}
