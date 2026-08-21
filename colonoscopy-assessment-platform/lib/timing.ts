export function captureVideoTimeAtClick(video: HTMLVideoElement | null) {
  return Math.round((video?.currentTime ?? 0) * 1000) / 1000;
}
