"use client";

import {
  Pause,
  Play,
  RotateCcw
} from "lucide-react";
import {
  type CSSProperties,
  type FormEvent,
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type Ref
} from "react";

export type AssessmentVideoPlayerProps = {
  playbackUrl: string;
  videoId: string;
  locked: boolean;
  onPlaybackStarted: () => void;
  onPlaybackStateChange: (isPlaying: boolean) => void;
  onEnded: (endedAtMs: number) => void;
  onVideoError: () => void;
};

type PlaybackPosition = {
  currentTime: number;
  duration: number;
};

const initialPosition: PlaybackPosition = { currentTime: 0, duration: 0 };

function formatPlaybackTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "0:00";
  }

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const remainingSeconds = totalSeconds % 60;

  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function setForwardedRef<T>(ref: Ref<T>, value: T | null) {
  if (typeof ref === "function") {
    ref(value);
    return;
  }

  if (ref) {
    ref.current = value;
  }
}

const AssessmentVideoPlayer = forwardRef<
  HTMLVideoElement,
  AssessmentVideoPlayerProps
>(function AssessmentVideoPlayer(
  {
    playbackUrl,
    videoId,
    locked,
    onPlaybackStarted,
    onPlaybackStateChange,
    onEnded,
    onVideoError
  },
  forwardedRef
) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const playbackStartedRef = useRef(false);
  const endedRef = useRef(false);
  const maxWatchedTimeRef = useRef(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [position, setPosition] = useState<PlaybackPosition>(initialPosition);

  const setVideoRef = useCallback(
    (node: HTMLVideoElement | null) => {
      videoRef.current = node;
      setForwardedRef(forwardedRef, node);
    },
    [forwardedRef]
  );

  const syncPosition = useCallback(() => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    setPosition({
      currentTime: Number.isFinite(video.currentTime) ? video.currentTime : 0,
      duration: Number.isFinite(video.duration) ? video.duration : 0
    });
  }, []);

  useEffect(() => {
    playbackStartedRef.current = false;
    endedRef.current = false;
    maxWatchedTimeRef.current = 0;
    setIsPlaying(false);
    setPosition(initialPosition);
  }, [videoId, playbackUrl]);

  const handlePlay = () => {
    if (locked) {
      videoRef.current?.pause();
      return;
    }

    if (!playbackStartedRef.current) {
      playbackStartedRef.current = true;
      onPlaybackStarted();
    }

    setIsPlaying(true);
    onPlaybackStateChange(true);
  };

  const handlePause = () => {
    setIsPlaying(false);
    onPlaybackStateChange(false);
  };

  const handleEnded = () => {
    const endedAtMs = performance.now();
    const shouldNotifyParent = !endedRef.current;

    if (shouldNotifyParent) {
      endedRef.current = true;
      maxWatchedTimeRef.current = videoRef.current?.duration ?? 0;
    }

    setIsPlaying(false);
    onPlaybackStateChange(false);

    if (shouldNotifyParent) {
      onEnded(endedAtMs);
    }
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;

    if (video && !endedRef.current && !video.seeking) {
      maxWatchedTimeRef.current = Math.max(
        maxWatchedTimeRef.current,
        video.currentTime
      );
    }

    syncPosition();
  };

  const handleSeeking = () => {
    const video = videoRef.current;

    if (
      !video ||
      endedRef.current ||
      video.currentTime <= maxWatchedTimeRef.current
    ) {
      return;
    }

    video.currentTime = maxWatchedTimeRef.current;
    syncPosition();
  };

  const requestPlayback = (video: HTMLVideoElement) => {
    void video.play().catch((error: unknown) => {
      if (error instanceof DOMException && error.name === "AbortError") {
        return;
      }

      onVideoError();
    });
  };

  const togglePlayback = () => {
    const video = videoRef.current;

    if (!video || locked) {
      return;
    }

    if (video.paused) {
      if (video.ended) {
        video.currentTime = 0;
        syncPosition();
      }

      requestPlayback(video);
      return;
    }

    video.pause();
  };

  const replayVideo = () => {
    const video = videoRef.current;

    if (!video || locked) {
      return;
    }

    video.currentTime = 0;
    syncPosition();
    requestPlayback(video);
  };

  const seekVideo = (event: FormEvent<HTMLInputElement>) => {
    const video = videoRef.current;

    if (!video || locked) {
      return;
    }

    const nextTime = Number(event.currentTarget.value);

    if (!Number.isFinite(nextTime)) {
      return;
    }

    const duration = Number.isFinite(video.duration)
      ? video.duration
      : nextTime;
    const seekLimit = endedRef.current
      ? duration
      : maxWatchedTimeRef.current;
    video.currentTime = Math.min(Math.max(0, nextTime), seekLimit);
    syncPosition();
  };

  const progressPercent =
    position.duration > 0
      ? Math.min(100, Math.max(0, (position.currentTime / position.duration) * 100))
      : 0;
  const playbackLocked = locked;
  const playPauseLabel = isPlaying ? "Pause video" : "Play video";

  return (
    <section
      className="assessment-video-player"
      aria-label={`Colonoscopy video ${videoId}`}
    >
      <video
        key={videoId}
        ref={setVideoRef}
        aria-label={`Video ${videoId}`}
        disablePictureInPicture
        onDurationChange={syncPosition}
        onEnded={handleEnded}
        onError={onVideoError}
        onLoadedMetadata={syncPosition}
        onPause={handlePause}
        onPlay={handlePlay}
        onSeeking={handleSeeking}
        onTimeUpdate={handleTimeUpdate}
        playsInline
        preload="metadata"
        src={playbackUrl}
      />

      <div className="assessment-video-player__controls">
        <div className="assessment-video-player__button-group">
          <button
            aria-label={playPauseLabel}
            className="assessment-video-player__icon-button"
            disabled={playbackLocked}
            onClick={togglePlayback}
            title={playPauseLabel}
            type="button"
          >
            {isPlaying ? <Pause aria-hidden="true" /> : <Play aria-hidden="true" />}
          </button>
          <button
            aria-label="Replay video"
            className="assessment-video-player__icon-button"
            disabled={playbackLocked}
            onClick={replayVideo}
            title="Replay video"
            type="button"
          >
            <RotateCcw aria-hidden="true" />
          </button>
        </div>

        <div className="assessment-video-player__timeline">
          <input
            aria-label="Seek video"
            className="assessment-video-player__progress"
            disabled={playbackLocked || position.duration <= 0}
            max={position.duration || 0}
            min={0}
            onInput={seekVideo}
            step={0.001}
            style={
              { "--playback-progress": `${progressPercent}%` } as CSSProperties
            }
            type="range"
            value={Math.min(position.currentTime, position.duration || 0)}
          />
          <div className="assessment-video-player__time" aria-live="off">
            <span>{formatPlaybackTime(position.currentTime)}</span>
            <span>{formatPlaybackTime(position.duration)}</span>
          </div>
        </div>
      </div>
    </section>
  );
});

AssessmentVideoPlayer.displayName = "AssessmentVideoPlayer";

export default AssessmentVideoPlayer;
