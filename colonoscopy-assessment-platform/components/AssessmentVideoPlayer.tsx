"use client";

import {
  Pause,
  Play,
  Volume2,
  VolumeX
} from "lucide-react";
import {
  forwardRef,
  useCallback,
  useEffect,
  useRef,
  useState,
  type Ref
} from "react";

export type AssessmentVideoPlayerProps = {
  signedUrl: string;
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
    signedUrl,
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
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
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
    setIsPlaying(false);
    setVideoEnded(false);
    setPosition(initialPosition);
  }, [videoId, signedUrl]);

  const handlePlay = () => {
    if (endedRef.current || locked) {
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
    if (endedRef.current) {
      return;
    }

    const endedAtMs = performance.now();
    endedRef.current = true;
    setIsPlaying(false);
    setVideoEnded(true);
    onPlaybackStateChange(false);
    onEnded(endedAtMs);
  };

  const togglePlayback = () => {
    const video = videoRef.current;

    if (!video || locked || endedRef.current) {
      return;
    }

    if (video.paused) {
      void video.play().catch(onVideoError);
      return;
    }

    video.pause();
  };

  const toggleMute = () => {
    const video = videoRef.current;

    if (!video) {
      return;
    }

    const nextMuted = !video.muted;
    video.muted = nextMuted;
    setIsMuted(nextMuted);
  };

  const progressPercent =
    position.duration > 0
      ? Math.min(100, Math.max(0, (position.currentTime / position.duration) * 100))
      : 0;
  const playbackLocked = locked || videoEnded;
  const playPauseLabel = isPlaying ? "Pause video" : "Play video";
  const muteLabel = isMuted ? "Unmute video" : "Mute video";

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
        muted={isMuted}
        onDurationChange={syncPosition}
        onEnded={handleEnded}
        onError={onVideoError}
        onLoadedMetadata={syncPosition}
        onPause={handlePause}
        onPlay={handlePlay}
        onTimeUpdate={syncPosition}
        playsInline
        preload="metadata"
        src={signedUrl}
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
            aria-label={muteLabel}
            className="assessment-video-player__icon-button"
            onClick={toggleMute}
            title={muteLabel}
            type="button"
          >
            {isMuted ? <VolumeX aria-hidden="true" /> : <Volume2 aria-hidden="true" />}
          </button>
        </div>

        <div className="assessment-video-player__timeline">
          <div
            aria-label="Playback progress"
            aria-valuemax={Math.round(position.duration)}
            aria-valuemin={0}
            aria-valuenow={Math.round(position.currentTime)}
            className="assessment-video-player__progress"
            role="progressbar"
          >
            <span style={{ width: `${progressPercent}%` }} />
          </div>
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
