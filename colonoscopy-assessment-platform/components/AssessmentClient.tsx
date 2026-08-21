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
  getResponseActionState
} from "@/lib/lesionResponse";
import {
  getStudyMode,
  isStudySessionNumber,
  STUDY_SESSION_NUMBERS
} from "@/lib/sessionConfig";
import {
  isSupabaseConfigured,
  loadAssessmentSession,
  submitVideoResponse,
  type VideoSource
} from "@/lib/supabaseClient";
import { captureVideoTimeAtClick } from "@/lib/timing";

type SaveState = "idle" | "saving" | "saved" | "error";
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
  const studyMode = getStudyMode();
  const currentVideo = videoQueue[currentIndex] ?? null;
  const totalVideos = videoQueue.length;
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const detectionClicksRef = useRef<LesionDetectionClick[]>([]);
  const finalizationGuardRef = useRef(false);
  const submissionInFlightRef = useRef(false);
  const videoStartedAtRef = useRef<number | null>(null);
  const videoEndedAtRef = useRef<number | null>(null);
  const normalizedParticipantId = participantId.trim();
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
      videoEndedAtRef.current !== null ||
      finalizationGuardRef.current ||
      videoError
    ) {
      return;
    }

    const nowMs = performance.now();
    const click = createLesionDetectionClick({
      clickIndex: detectionClicksRef.current.length + 1,
      videoTimeSec: captureVideoTimeAtClick(videoRef.current),
      nowMs,
      playbackStartedAtMs,
      lesionOnsetSec: currentVideo.lesionOnsetSec
    });
    const nextClicks = [...detectionClicksRef.current, click];
    detectionClicksRef.current = nextClicks;
    setDetectionClicks(nextClicks);
    console.log("lesion detection click", {
      video_id: currentVideo.videoId,
      ...click
    });
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
      setSaveState("saved");

      const nextIndex = currentIndex + 1;

      if (nextIndex >= totalVideos) {
        setCompletedSession({
          participantId: submission.participant_id,
          sessionNumber: submission.session_number,
          totalVideos
        });
        setPhase("complete");
        return;
      }

      setCurrentIndex(nextIndex);
    } catch (error) {
      setSaveState("error");
      setSaveError(
        error instanceof Error ? error.message : "Unable to save response."
      );
    } finally {
      submissionInFlightRef.current = false;
    }
  };

  const finalizeVideo = (finalClassification: LesionAnswer) => {
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

    const submission = buildVideoSubmission(
      {
        participant_id: normalizedParticipantId,
        session_number: parsedSessionNumber,
        video_id: currentVideo.videoId,
        video_order: currentVideo.videoOrder,
        finalClassification,
        clicks: detectionClicksRef.current,
        nowMs: performance.now(),
        playbackStartedAtMs,
        videoEndedAtMs
      }
    );
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
              <AssessmentVideoPlayer
                ref={videoRef}
                key={currentVideo.videoId}
                locked={finalizationLocked}
                onEnded={handleVideoEnded}
                onPlaybackStarted={handleVideoPlay}
                onPlaybackStateChange={setVideoPlaying}
                onVideoError={() =>
                  setVideoError(`Cannot play signed URL for ${currentVideo.videoId}.`)
                }
                signedUrl={currentVideo.signedUrl}
                videoId={currentVideo.videoId}
              />
              <div className="video-caption">
                <span>{currentVideo.videoId}</span>
                <span>
                  {videoEnded
                    ? "Playback complete"
                    : videoPlaying
                      ? "Playing"
                      : videoStarted
                        ? "Paused"
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

              {videoStarted && !videoEnded && !videoError && !finalizationLocked && (
                <div className="pending-state">
                  <div className="pulse-dot" />
                  <span>Detection is active.</span>
                </div>
              )}

              {videoEnded && !finalizationLocked && !videoError && (
                <div className="pending-state">
                  <div className="pulse-dot" />
                  <span>Choose the final classification.</span>
                </div>
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
                onFinalizeNo={() => finalizeVideo("no")}
                onFinalizeYes={() => finalizeVideo("yes")}
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
