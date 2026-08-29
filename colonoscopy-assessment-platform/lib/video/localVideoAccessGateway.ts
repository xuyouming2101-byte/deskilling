import "server-only";

import type { CurrentVideoAuthorizationRepository } from "../assessment/contracts.ts";
import type { VideoAccessGateway } from "./contracts.ts";

export class LocalVideoAccessGateway implements VideoAccessGateway {
  private readonly authorizationRepository: CurrentVideoAuthorizationRepository;

  constructor(authorizationRepository: CurrentVideoAuthorizationRepository) {
    this.authorizationRepository = authorizationRepository;
  }

  async getCurrentVideo(input: { attemptId: string; videoOrder: number }) {
    const authorized =
      await this.authorizationRepository.authorizeCurrentVideo(
        input.attemptId,
        input.videoOrder
      );

    return {
      attemptId: input.attemptId,
      videoId: authorized.videoId,
      videoOrder: input.videoOrder,
      url: `/api/local/attempts/${encodeURIComponent(input.attemptId)}/videos/${input.videoOrder}`,
      expiresAt: null
    };
  }
}
