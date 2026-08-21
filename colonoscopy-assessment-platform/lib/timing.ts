import type { LesionAnswer } from "@/lib/assessmentTypes";

export function captureVideoTimeAtClick(video: HTMLVideoElement | null) {
  return Math.round((video?.currentTime ?? 0) * 1000) / 1000;
}

export function calculateDetectionLatencyMs(
  answer: LesionAnswer,
  videoTimeAtClick: number,
  lesionOnsetSec: number | null
) {
  if (answer !== "yes" || lesionOnsetSec === null) {
    return null;
  }

  return Math.round((videoTimeAtClick - lesionOnsetSec) * 1000);
}
