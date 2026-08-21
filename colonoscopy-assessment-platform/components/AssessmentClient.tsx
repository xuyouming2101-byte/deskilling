"use client";

import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Database,
  PlayCircle,
  RotateCcw
} from "lucide-react";
import { type FormEvent, useEffect, useRef, useState } from "react";
import LesionSurvey from "@/components/LesionSurvey";
import type { LesionAnswer, ResponseInsert } from "@/lib/assessmentTypes";
import {
  getStudyMode,
  isStudySessionNumber,
  STUDY_SESSION_NUMBERS
} from "@/lib/sessionConfig";
import {
  insertResponse,
  isSupabaseConfigured,
  loadAssessmentSession,
  type VideoSource
} from "@/lib/supabaseClient";
import {
  calculateDetectionLatencyMs,
  captureVideoTimeAtClick
} from "@/lib/timing";

type SaveState = "idle" | "saving" | "error";
type Phase = "intake" | "loading" | "assessment" | "complete" | "error";
type CompletedSession = {
  participantId: string;
  sessionNumber: number;
  totalVideos: number;
};

export default function AssessmentClient() {
  const [phase, setPhase] = useState<Phase>("intake");
  const [videoQueue, setVideoQueue] = useState<VideoSource[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [participantId, setParticipantId] = useState("");
  const [sessionNumber, setSessionNumber] = useState("1");
  const [intakeError, setIntakeError] = useState("");
  const [videoStarted, setVideoStarted] = useState(false);
  const [videoEnded, setVideoEnded] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [videoError, setVideoError] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState("");
  const [lastAnswer, setLastAnswer] = useState<LesionAnswer | null>(null);
  const [pendingPayload, setPendingPayload] = useState<ResponseInsert | null>(null);
  const [responseLocked, setResponseLocked] = useState(false);
  const [completedSession, setCompletedSession] =
    useState<CompletedSession | null>(null);

  const configured = isSupabaseConfigured();
  const studyMode = getStudyMode();
  const currentVideo = videoQueue[currentIndex] ?? null;
  const totalVideos = videoQueue.length;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const responseLockedRef = useRef(false);
  const videoStartedAtRef = useRef<number | null>(null);
  const normalizedParticipantId = participantId.trim();
  const parsedSessionNumber = Number.parseInt(sessionNumber, 10);

  const resetResponseState = () => {
    setVideoStarted(false);
    setVideoEnded(false);
    setVideoError("");
    setSaveState("idle");
    setSaveError("");
    setLastAnswer(null);
    setPendingPayload(null);
    setResponseLocked(false);
    responseLockedRef.current = false;
    videoStartedAtRef.current = null;
  };

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
    resetResponseState();

    try {
      const session = await loadAssessmentSession(
        normalizedParticipantId,
        parsedSessionNumber
      );

      setVideoQueue(session.videoQueue);
      setCurrentIndex(session.startIndex);
      setCompletedSession(
        session.isComplete
          ? {
              participantId: normalizedParticipantId,
              sessionNumber: parsedSessionNumber,
              totalVideos: session.videoQueue.length
            }
          : null
      );
      setPendingPayload(null);
      setResponseLocked(session.isComplete);
      responseLockedRef.current = session.isComplete;
      setPhase(session.isComplete ? "complete" : "assessment");
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : "Unable to load videos.");
      setPhase("error");
    }
  };

  const startAssessment = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

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
    void loadQueue();
  };

  useEffect(() => {
    if (!currentVideo) {
      return;
    }

    console.log("current video_id", currentVideo.videoId);
    setVideoStarted(false);
    setVideoEnded(false);
    setVideoError("");
    setSaveState("idle");
    setSaveError("");
    setPendingPayload(null);
    setResponseLocked(false);
    responseLockedRef.current = false;
    videoStartedAtRef.current = null;
  }, [currentVideo]);

  const handleVideoPlay = () => {
    if (videoStartedAtRef.current === null) {
      videoStartedAtRef.current = performance.now();
    }

    setVideoStarted(true);
  };

  const handleVideoEnded = () => {
    setVideoEnded(true);
  };

  const saveAnswer = async (answer: LesionAnswer, payload?: ResponseInsert) => {
    if (!payload && (!currentVideo || responseLockedRef.current)) {
      return;
    }

    if (!payload && answer === "yes" && !videoStarted) {
      return;
    }

    if (!payload && answer === "no" && !videoEnded) {
      return;
    }

    const now = performance.now();
    const videoTimeAtClick = payload
      ? payload.video_time_at_click
      : captureVideoTimeAtClick(videoRef.current);
    const responseTimeMs = payload
      ? payload.response_time_ms
      : Math.max(0, Math.round(now - (videoStartedAtRef.current ?? now)));
    const lesionOnsetSec = currentVideo?.lesionOnsetSec ?? null;
    const detectionLatencyMs = payload
      ? payload.detection_latency_ms
      : calculateDetectionLatencyMs(answer, videoTimeAtClick, lesionOnsetSec);
    const responsePayload =
      payload ??
      ({
        participant_id: normalizedParticipantId,
        session_number: parsedSessionNumber,
        video_id: currentVideo!.videoId,
        video_order: currentVideo!.videoOrder,
        answer,
        correct: currentVideo!.hasLesion === (answer === "yes"),
        response_type:
          answer === "yes" ? "lesion_detected" : "no_lesion_detected",
        response_time_ms: responseTimeMs,
        video_time_at_click: videoTimeAtClick,
        detection_latency_ms: detectionLatencyMs,
        video_completed: videoEnded
      } satisfies ResponseInsert);

    if (!payload && answer === "yes") {
      console.log("lesion detection timing", {
        video_id: currentVideo!.videoId,
        video_time_at_click: videoTimeAtClick,
        lesion_onset_sec: lesionOnsetSec,
        detection_latency_ms: detectionLatencyMs
      });
    }

    if (!payload) {
      responseLockedRef.current = true;
      setResponseLocked(true);
    }

    setSaveState("saving");
    setSaveError("");
    setLastAnswer(answer);
    setPendingPayload(responsePayload);

    try {
      await insertResponse(responsePayload);
      setPendingPayload(null);

      const nextIndex = currentIndex + 1;

      if (nextIndex >= totalVideos) {
        setCompletedSession({
          participantId: normalizedParticipantId,
          sessionNumber: parsedSessionNumber,
          totalVideos
        });
        setPendingPayload(null);
        setPhase("complete");
        return;
      }

      setCurrentIndex(nextIndex);
    } catch (error) {
      setSaveState("error");
      setSaveError(
        error instanceof Error ? error.message : "Unable to save response."
      );
    }
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
    setLoadError("");
    setIntakeError("");
    setCompletedSession(null);
    resetResponseState();

    if (Number.isInteger(nextSessionNumber) && isStudySessionNumber(nextSessionNumber)) {
      setSessionNumber(String(nextSessionNumber));
    }
  };

  const canAnswer =
    phase === "assessment" &&
    Boolean(currentVideo) &&
    configured &&
    videoStarted &&
    !responseLocked &&
    !videoError &&
    saveState !== "saving";
  const canReportNoLesion = canAnswer && videoEnded;

  const progressPercent =
    totalVideos > 0 ? Math.round(((currentIndex + 1) / totalVideos) * 100) : 0;

  return (
    <main className="assessment-shell">
      <section className="topbar" aria-label="Assessment status">
        <div>
          <p className="eyebrow">Supabase video queue</p>
          <h1>Colonoscopy Lesion Check</h1>
        </div>
        <div className="status-pill">
          <Database size={18} aria-hidden="true" />
          <span>{configured ? "Supabase ready" : "Supabase not configured"}</span>
        </div>
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
                placeholder="P001"
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

            {intakeError && (
              <div className="alert-box critical">
                <AlertTriangle size={18} aria-hidden="true" />
                <span>{intakeError}</span>
              </div>
            )}

            <button className="primary-button" type="submit">
              Start
            </button>
          </form>

          <aside className="protocol-panel" aria-label="Assessment setup">
            <div className="metric-row">
              <span>Queue</span>
              <strong>Eligible videos</strong>
            </div>
            <div className="metric-row">
              <span>Mode</span>
              <strong>{studyMode.toUpperCase()}</strong>
            </div>
            <div className="metric-row">
              <span>Source</span>
              <strong>Supabase</strong>
            </div>
            <div className="metric-row">
              <span>Sessions</span>
              <strong>1, 2, 3</strong>
            </div>
            <div className="metric-row">
              <span>Responses</span>
              <strong>public.responses</strong>
            </div>
          </aside>
        </section>
      )}

      {phase === "loading" && (
        <section className="complete-panel">
          <div className="spinner" />
          <p className="eyebrow">Loading</p>
          <h2>Fetching videos and signed URLs from Supabase.</h2>
        </section>
      )}

      {phase === "error" && (
        <section className="complete-panel">
          <AlertTriangle size={36} aria-hidden="true" />
          <p className="eyebrow">Configuration or loading error</p>
          <h2>{loadError}</h2>
        </section>
      )}

      {phase === "assessment" && currentVideo && (
        <section className="workbench">
          <div className="progress-block" aria-label="Video progress">
            <div className="progress-labels">
              <span>
                Video {currentIndex + 1} / {totalVideos}
              </span>
              <span>{currentVideo.videoId}</span>
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
              <video
                key={currentVideo.videoId}
                ref={videoRef}
                controls
                controlsList="nodownload noplaybackrate"
                onEnded={handleVideoEnded}
                onError={() =>
                  setVideoError(`Cannot play signed URL for ${currentVideo.videoId}.`)
                }
                onPlay={handleVideoPlay}
                playsInline
                preload="metadata"
                src={currentVideo.signedUrl}
              />
              <div className="video-caption">
                <span>{currentVideo.videoId}</span>
                <span>
                  {videoStarted
                    ? "Playback started"
                    : `${currentVideo.bucket}/${currentVideo.filePath}`}
                </span>
              </div>
            </section>

            <aside className="response-panel" aria-label="Yes or No response">
              <div className="response-header">
                <PlayCircle size={18} aria-hidden="true" />
                <div>
                  <p className="eyebrow">Response</p>
                  <h2>Lesion detected?</h2>
                </div>
              </div>

              {videoError && (
                <div className="alert-box critical">
                  <AlertTriangle size={18} aria-hidden="true" />
                  <span>{videoError}</span>
                </div>
              )}

              {!videoStarted && !videoError && (
                <div className="pending-state">
                  <div className="pulse-dot" />
                  <span>Start playback to enable lesion detection.</span>
                </div>
              )}

              {videoStarted && !videoEnded && !videoError && !responseLocked && (
                <div className="pending-state">
                  <div className="pulse-dot" />
                  <span>Click Lesion detected when a lesion is visible.</span>
                </div>
              )}

              {videoEnded && !responseLocked && !videoError && (
                <div className="pending-state">
                  <div className="pulse-dot" />
                  <span>Video ended. No lesion detected is now available.</span>
                </div>
              )}

              <LesionSurvey
                clipId={currentVideo.videoId}
                canDetectLesion={canAnswer}
                canReportNoLesion={canReportNoLesion}
                locked={responseLocked || saveState === "saving"}
                onAnswer={(answer) => void saveAnswer(answer)}
              />

              {saveState === "saving" && (
                <div className="saving-state">
                  <div className="spinner" />
                  <span>Writing response</span>
                </div>
              )}

              {lastAnswer && saveState === "idle" && currentIndex > 0 && (
                <div className="saved-state">
                  <CheckCircle2 size={24} aria-hidden="true" />
                  <span>Previous response recorded.</span>
                </div>
              )}

              {saveState === "error" && pendingPayload && (
                <div className="save-error">
                  <div className="alert-box critical">
                    <AlertTriangle size={18} aria-hidden="true" />
                    <span>{saveError}</span>
                  </div>
                  <button
                    className="secondary-button"
                    onClick={() => void saveAnswer(pendingPayload.answer, pendingPayload)}
                    type="button"
                  >
                    <RotateCcw size={18} aria-hidden="true" />
                    <span>Retry locked response</span>
                  </button>
                </div>
              )}
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
