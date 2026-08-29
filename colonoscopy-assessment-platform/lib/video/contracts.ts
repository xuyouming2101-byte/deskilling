export interface VideoAccessGateway {
  getCurrentVideo(input: {
    attemptId: string;
    videoOrder: number;
  }): Promise<{
    attemptId: string;
    videoId: string;
    videoOrder: number;
    url: string;
    expiresAt: string | null;
  }>;
}
