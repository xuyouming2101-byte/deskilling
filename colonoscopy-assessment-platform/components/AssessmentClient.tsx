"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  RotateCcw
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import AssessmentVideoPlayer from "@/components/AssessmentVideoPlayer";
import LesionSurvey from "@/components/LesionSurvey";
import type {
  LesionAnswer,
  LesionDetectionClick,
  VideoSubmission
} from "@/lib/assessmentTypes";
import {
  buildVideoSubmission,
  createLesionDetectionClick,
  getResponseActionState,
  removeLesionDetectionClick
} from "@/lib/lesionResponse";
import {
  isStudySessionNumber,
  STUDY_SESSION_NUMBERS
} from "@/lib/sessionConfig";
import {
  isSupabaseConfigured,
  loadAssessmentSession,
  loadCurrentVideoSource,
  submitVideoResponse,
  type VideoQueueItem
} from "@/lib/supabaseClient";
import { captureVideoTimeAtClick } from "@/lib/timing";

type SaveState = "idle" | "saving" | "saved" | "error";
type Phase = "intake" | "loading" | "assessment" | "complete" | "error";
type CompletedSession = {
  participantId: string;
  sessionNumber: number;
  totalVideos: number;
};

type AssessmentClientProps = {
  requiresOnlinePassword?: boolean;
};

export default function AssessmentClient({
  requiresOnlinePassword = false
}: AssessmentClientProps) {
  const [phase, setPhase] = useState<Phase>("intake");
  const [videoQueue, setVideoQueue] = useState<VideoQueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [signedVideoUrl, setSignedVideoUrl] = useState("");
  const [participantId, setParticipantId] = useState("");
  const [sessionNumber, setSessionNumber] = useState("1");
  const [onlinePassword, setOnlinePassword] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [passwordVerificationInFlight, setPasswordVerificationInFlight] =
    useState(false);
  const [intakeError, setIntakeError] = useState("");
  const [videoStarted, setVideoStarted] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [videoPlaying, setVideoPlaying] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [videoError, setVideoError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const [detectionClicks, setDetectionClicks] = useState<
    LesionDetectionClick[]
  >([]);
  const [finalClassification, setFinalClassification] =
    useState<LesionAnswer | null>(null);
  const [pendingSubmission, setPendingSubmission] =
    useState<VideoSubmission | null>(null);
  const [finalizationLocked, setFinalizationLocked] = useState(false);
  const [completedSession, setCompletedSession] =
    useState<CompletedSession | null>(null);

  const configured = isSupabaseConfigured();
  const currentVideo = videoQueue[currentIndex] ?? null;
  const totalVideos = videoQueue.length;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const detectionClicksRef = useRef<LesionDetectionClick[]>([]);
  const finalizationGuardRef = useRef(false);
  const submissionInFlightRef = useRef(false);
  const videoStartedAtRef = useRef<number | null>(null);
  const videoEndedAtRef = useRef<number | null>(null);
  const normalizedParticipantId = participantId.trim().toUpperCase();
  const parsedSessionNumber = Number.parseInt(sessionNumber, 10);

  useEffect(() => {
    if (!configured) {
      setPhase("error");
      setLoadError(
        "Configuration error: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY."
      );
      return;
    }
  }, [configured]);

  const loadQueue = async () => {
    setPhase("loading");
    setLoadError("");
    setCompletedSession(null);

    const session = await loadAssessmentSession(
      normalizedParticipantId,
      parsedSessionNumber
    );
    let nextSignedVideoUrl = "";

    if (!session.isComplete) {
      const nextVideo = session.videoQueue[session.startIndex];

      if (!nextVideo) {
        throw new Error("Assessment queue did not contain the next video.");
      }

      const videoSource = await loadCurrentVideoSource(
        normalizedParticipantId,
        parsedSessionNumber,
        nextVideo,
        session.studyMode
      );
      nextSignedVideoUrl = videoSource.signedUrl;
    }

    setVideoQueue(session.videoQueue);
    setCurrentIndex(session.startIndex);
    setSignedVideoUrl(nextSignedVideoUrl);
    setCompletedSession(
      session.isComplete
        ? {
            participantId: normalizedParticipantId,
            sessionNumber: parsedSessionNumber,
            totalVideos: session.videoQueue.length
          }
        : null
    );
    setPhase(session.isComplete ? "complete" : "assessment");
  };

  const startAssessment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setPasswordError("");

    if (!normalizedParticipantId) {
      setIntakeError("Participant ID is required.");
      return;
    }

    if (
      !Number.isInteger(parsedSessionNumber) ||
      !isStudySessionNumber(parsedSessionNumber)
    ) {
      setIntakeError("Session number must be 1, 2, or 3.");
      return;
    }

    setIntakeError("");

    if (requiresOnlinePassword) {
      setPasswordVerificationInFlight(true);

      try {
        const response = await fetch("/api/online-password", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            participant_id: normalizedParticipantId,
            session_number: parsedSessionNumber,
            password: onlinePassword
          })
        });
        const result = (await response.json().catch(() => ({}))) as {
          authorized?: boolean;
          error?: string;
        };

        if (!response.ok || result.authorized !== true) {
          setPasswordError(result.error ?? "Incorrect password.");
          return;
        }

        setOnlinePassword("");
      } catch {
        setPasswordError("Unable to verify the password. Please try again.");
        return;
      } finally {
        setPasswordVerificationInFlight(false);
      }
    }

    void loadQueue().catch((error) => {
      setIntakeError(
        error instanceof Error ? error.message : "Unable to load videos."
      );
      setPhase("intake");
    });
  };

  useEffect(() => {
    if (currentVideo) {
      console.log("current video_id", currentVideo.videoId);
    }

    setVideoStarted(false);
    setVideoEnded(false);
    setVideoPlaying(false);
    setVideoError("");
    setSaveState("idle");
    setSaveError("");
    setDetectionClicks([]);
    setFinalClassification(null);
    setPendingSubmission(null);
    setFinalizationLocked(false);
    detectionClicksRef.current = [];
    finalizationGuardRef.current = false;
    submissionInFlightRef.current = false;
    videoStartedAtRef.current = null;
    videoEndedAtRef.current = null;
  }, [currentVideo]);

  const handleVideoPlay = () => {
    if (videoStartedAtRef.current === null) {
      videoStartedAtRef.current = performance.now();
    }

    setVideoStarted(true);
  };

  const handleVideoEnded = (endedAtMs: number) => {
    videoEndedAtRef.current = endedAtMs;
    setVideoEnded(true);
  };

  const handleDetect = () => {
    const playbackStartedAtMs = videoStartedAtRef.current;

    if (
      !currentVideo ||
      !videoRef.current ||
      playbackStartedAtMs === null ||
      finalizationGuardRef.current ||
      videoError
    ) {
      return;
    }

    const videoTimeSec = captureVideoTimeAtClick(videoRef.current);
    const nowMs = performance.now();
    const click = createLesionDetectionClick({
      clickIndex: detectionClicksRef.current.length + 1,
      videoTimeSec,
      nowMs,
      playbackStartedAtMs
    });
    const nextClicks = [...detectionClicksRef.current, click];
    detectionClicksRef.current = nextClicks;
    setDetectionClicks(nextClicks);
    console.log("lesion detection click", {
      video_id: currentVideo.videoId,
      ...click
    });
  };

  const handleDeleteMark = (clickIndex: number) => {
    if (finalizationGuardRef.current) {
      return;
    }

    const nextClicks = removeLesionDetectionClick(
      detectionClicksRef.current,
      clickIndex
    );
    detectionClicksRef.current = nextClicks;
    setDetectionClicks(nextClicks);
  };

  const submitPendingSubmission = async (submission: VideoSubmission) => {
    if (submissionInFlightRef.current) {
      return;
    }

    submissionInFlightRef.current = true;
    setSaveState("saving");
    setSaveError("");

    try {
      await submitVideoResponse(submission);
      await loadQueue();
      setSaveState("saved");
    } catch (error) {
      setPhase("assessment");
      setSaveState("error");
      setSaveError(
        error instanceof Error ? error.message : "Unable to save response."
      );
    } finally {
      submissionInFlightRef.current = false;
    }
  };

  const finalizeVideo = (
    finalClassification: LesionAnswer,
    finalizedAtMs: number
  ) => {
    const playbackStartedAtMs = videoStartedAtRef.current;
    const videoEndedAtMs = videoEndedAtRef.current;

    if (
      !currentVideo ||
      playbackStartedAtMs === null ||
      videoEndedAtMs === null ||
      finalizationGuardRef.current ||
      (finalClassification === "yes" && detectionClicksRef.current.length === 0)
    ) {
      return;
    }

    const clicksToSubmit =
      finalClassification === "no" ? [] : detectionClicksRef.current;
    const submission = buildVideoSubmission({
      participant_id: normalizedParticipantId,
      session_number: parsedSessionNumber,
      video_id: currentVideo.videoId,
      video_order: currentVideo.videoOrder,
      finalClassification,
      clicks: clicksToSubmit,
      nowMs: finalizedAtMs,
      playbackStartedAtMs,
      videoEndedAtMs
    });
    finalizationGuardRef.current = true;
    setFinalizationLocked(true);
    setFinalClassification(finalClassification);
    setPendingSubmission(submission);

    if (finalClassification === "no") {
      detectionClicksRef.current = [];
      setDetectionClicks([]);
    }

    void submitPendingSubmission(submission);
  };

  const retrySubmission = () => {
    if (!pendingSubmission) {
      return;
    }

    void submitPendingSubmission(pendingSubmission);
  };

  const prepareNewSession = () => {
    const currentSessionNumber = completedSession?.sessionNumber ?? parsedSessionNumber;
    const nextSessionNumber =
      isStudySessionNumber(currentSessionNumber) && currentSessionNumber < 3
        ? currentSessionNumber + 1
        : currentSessionNumber;

    setPhase("intake");
    setVideoQueue([]);
    setCurrentIndex(0);
    setSignedVideoUrl("");
    setLoadError("");
    setIntakeError("");
    setCompletedSession(null);

    if (Number.isInteger(nextSessionNumber) && isStudySessionNumber(nextSessionNumber)) {
      setSessionNumber(String(nextSessionNumber));
    }
  };

  const actionState = getResponseActionState({
    videoStarted:
      phase === "assessment" && Boolean(currentVideo) && configured && videoStarted,
    videoEnded,
    clickCount: detectionClicks.length,
    locked: finalizationLocked || Boolean(videoError)
  });

  const progressPercent =
    totalVideos > 0 ? Math.round(((currentIndex + 1) / totalVideos) * 100) : 0;

  return (
    <main className="assessment-shell">
      <section className="topbar" aria-label="Assessment status">
        <h1>Colonoscopy Lesion Check</h1>
      </section>

      {phase === "intake" && (
        <section className="intake-grid" aria-label="Participant intake">
          <form className="intake-panel" onSubmit={startAssessment}>
            <div className="panel-heading">
              <ClipboardList size={22} aria-hidden="true" />
              <div>
                <p className="eyebrow">Participant</p>
                <h2>Start assessment</h2>
              </div>
            </div>

            <label className="field">
              <span>Participant ID</span>
              <input
                autoComplete="off"
                onChange={(event) => setParticipantId(event.target.value)}
                placeholder="P01"
                value={participantId}
              />
            </label>

            <label className="field">
              <span>Session number</span>
              <select
                onChange={(event) => setSessionNumber(event.target.value)}
                value={sessionNumber}
              >
                {STUDY_SESSION_NUMBERS.map((studySessionNumber) => (
                  <option key={studySessionNumber} value={studySessionNumber}>
                    Session {studySessionNumber}
                  </option>
                ))}
              </select>
            </label>

            {requiresOnlinePassword && (
              <label className="field">
                <span>Password</span>
                <input
                  type="password"
                  autoComplete="current-password"
                  onChange={(event) => setOnlinePassword(event.target.value)}
                  value={onlinePassword}
                  required
                />
              </label>
            )}

            {passwordError && (
              <p className="online-password-error" role="alert">
                {passwordError}
              </p>
            )}

            {intakeError && (
              <div className="alert-box critical">
                <AlertTriangle size={18} aria-hidden="true" />
                <span>{intakeError}</span>
              </div>
            )}

            <button
              className="primary-button"
              type="submit"
              disabled={passwordVerificationInFlight}
            >
              {passwordVerificationInFlight ? "Checking..." : "Start"}
            </button>
          </form>

          <aside className="protocol-panel" aria-label="Assessment setup">
            <div className="metric-row">
              <span>Queue</span>
              <strong>Eligible videos</strong>
            </div>
            <div className="metric-row">
              <span>Mode</span>
              <strong>Server controlled</strong>
            </div>
            <div className="metric-row">
              <span>Source</span>
              <strong>Private study videos</strong>
            </div>
            <div className="metric-row">
              <span>Sessions</span>
              <strong>1, 2, 3</strong>
            </div>
            <div className="metric-row">
              <span>Responses</span>
              <strong>Recorded securely</strong>
            </div>
          </aside>
        </section>
      )}

      {phase === "loading" && (
        <section className="complete-panel">
          <div className="spinner" />
          <p className="eyebrow">Loading</p>
          <h2>Authorizing the current video from Supabase.</h2>
        </section>
      )}

      {phase === "error" && (
        <section className="complete-panel">
          <AlertTriangle size={36} aria-hidden="true" />
          <p className="eyebrow">Configuration or loading error</p>
          <h2>{loadError}</h2>
        </section>
      )}

      {phase === "assessment" && currentVideo && signedVideoUrl && (
        <section className="workbench">
          <div className="progress-block" aria-label="Video progress">
            <div className="progress-labels">
              <span>
                Video {currentIndex + 1} / {totalVideos}
              </span>
              <span>{progressPercent}% complete</span>
            </div>
            <div className="progress-track">
              <div
                className="progress-fill"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <div className="assessment-grid">
            <section className="video-panel" aria-label="Current colonoscopy video">
              <AssessmentVideoPlayer
                ref={videoRef}
                key={currentVideo.videoId}
                locked={finalizationLocked}
                onEnded={handleVideoEnded}
                onPlaybackStarted={handleVideoPlay}
                onPlaybackStateChange={setVideoPlaying}
                onVideoError={() => setVideoError("Cannot play the current video.")}
                playbackUrl={signedVideoUrl}
                videoId={currentVideo.videoId}
              />
            </section>

            <aside className="response-panel" aria-label="Yes or No response">
              <div className="response-header">
                <div>
                  <p className="eyebrow">Response</p>
                  <h2>Lesion detected?</h2>
                  <p className="response-guidance">
                    Mark each visible lesion when you first detect it.
                  </p>
                </div>
              </div>

              {videoError && (
                <div className="alert-box critical">
                  <AlertTriangle size={18} aria-hidden="true" />
                  <span>{videoError}</span>
                </div>
              )}

              {!videoStarted && !videoError && (
                <p className="playback-guidance">
                  Start playback to enable lesion detection.
                </p>
              )}

              {videoStarted && !videoEnded && !videoError && !finalizationLocked && (
                <p className="playback-guidance">Detection is active.</p>
              )}

              {videoEnded && !finalizationLocked && !videoError && (
                <p className="playback-guidance">
                  Playback complete. Choose the final classification.
                </p>
              )}

              <LesionSurvey
                clipId={currentVideo.videoId}
                clickCount={detectionClicks.length}
                clicks={detectionClicks}
                canDetect={actionState.canDetect}
                canReportNoLesion={actionState.canReportNoLesion}
                canGoNext={actionState.canGoNext}
                locked={finalizationLocked}
                onDetect={handleDetect}
                onDeleteMark={handleDeleteMark}
                onFinalizeNo={(noClickedAtMs) => finalizeVideo("no", noClickedAtMs)}
                onFinalizeYes={() => finalizeVideo("yes", performance.now())}
              />

              <div className="submission-status" aria-live="polite">
                {saveState === "saving" && (
                  <div className="saving-state">
                    <div className="spinner" />
                    <span>Saving final response</span>
                  </div>
                )}

                {saveState === "saved" && (
                  <div className="saved-state">
                    <CheckCircle2 size={24} aria-hidden="true" />
                    <span>Response saved.</span>
                  </div>
                )}

                {saveState === "error" && pendingSubmission && (
                  <div className="save-error">
                    <div className="alert-box critical">
                      <AlertTriangle size={18} aria-hidden="true" />
                      <span>{saveError}</span>
                    </div>
                    <button
                      className="secondary-button"
                      disabled={submissionInFlightRef.current}
                      onClick={retrySubmission}
                      type="button"
                    >
                      <RotateCcw size={18} aria-hidden="true" />
                      <span>Retry submission</span>
                    </button>
                  </div>
                )}

                {saveState === "idle" && finalClassification && (
                  <span className="submission-status__label">
                    Final classification: {finalClassification}
                  </span>
                )}
              </div>
            </aside>
          </div>
        </section>
      )}

      {phase === "complete" && (
        <section className="complete-panel">
          <CheckCircle2 size={38} aria-hidden="true" />
          <p className="eyebrow">Complete</p>
          <h2>
            All {completedSession?.totalVideos ?? totalVideos} videos have been
            completed.
          </h2>
          <div className="session-lock">
            <span>Participant</span>
            <strong>{completedSession?.participantId ?? normalizedParticipantId}</strong>
            <span>Session</span>
            <strong>{completedSession?.sessionNumber ?? parsedSessionNumber}</strong>
            <span>Status</span>
            <strong>Locked</strong>
          </div>
          <p className="complete-note">
            This completed session cannot be restarted or submitted again. Use a
            different session number to begin another assessment for the same
            participant.
          </p>
          <button
            className="secondary-button"
            onClick={prepareNewSession}
            type="button"
          >
            <ClipboardList size={18} aria-hidden="true" />
            <span>Choose session</span>
          </button>
        </section>
      )}
    </main>
  );
}
