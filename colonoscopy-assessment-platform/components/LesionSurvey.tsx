"use client";

import { ArrowRight, Ban, Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo } from "react";
import { Model } from "survey-core";
import type {
  LesionAnswer,
  LesionDetectionClick
} from "@/lib/assessmentTypes";

type LesionSurveyProps = {
  clipId: string;
  clickCount: number;
  clicks: readonly LesionDetectionClick[];
  canDetect: boolean;
  canReportNoLesion: boolean;
  canGoNext: boolean;
  locked: boolean;
  onDetect: () => void;
  onDeleteMark: (clickIndex: number) => void;
  onFinalizeYes: () => void;
  onFinalizeNo: (clickedAtMs: number) => void;
};

function formatVideoTime(seconds: number) {
  const wholeMinutes = Math.floor(seconds / 60);
  const remainingSeconds = (seconds % 60).toFixed(3).padStart(6, "0");

  return `${wholeMinutes}:${remainingSeconds}`;
}

export default function LesionSurvey({
  clipId,
  clickCount,
  clicks,
  canDetect,
  canReportNoLesion,
  canGoNext,
  locked,
  onDetect,
  onDeleteMark,
  onFinalizeYes,
  onFinalizeNo
}: LesionSurveyProps) {
  const survey = useMemo(() => {
    const model = new Model({
      elements: [
        {
          type: "radiogroup",
          name: "finalClassification",
          isRequired: true,
          choices: ["yes", "no"]
        }
      ]
    });

    model.focusFirstQuestionAutomatic = false;
    model.showCompletedPage = false;
    return model;
  }, [clipId]);

  useEffect(() => {
    survey.clearValue("finalClassification");
  }, [clipId, survey]);

  const validateFinalClassification = useCallback(
    (answer: LesionAnswer) => {
      survey.setValue("finalClassification", answer);
      const isValid = survey.validate(false, false);

      if (!isValid || survey.getValue("finalClassification") !== answer) {
        survey.clearValue("finalClassification");
        return false;
      }

      return true;
    },
    [survey]
  );

  const handleFinalizeYes = () => {
    if (canGoNext && !locked && validateFinalClassification("yes")) {
      onFinalizeYes();
    }
  };

  const handleFinalizeNo = () => {
    const noClickedAtMs = performance.now();

    if (
      clickCount > 0 &&
      !window.confirm("现有 marks 将不会被记录。是否继续？")
    ) {
      return;
    }

    if (
      canReportNoLesion &&
      !locked &&
      validateFinalClassification("no")
    ) {
      onFinalizeNo(noClickedAtMs);
    }
  };

  const showFinalActions = canReportNoLesion || canGoNext || locked;

  return (
    <div className="survey-shell">
      <div className="detection-zone">
        <button
          className="detection-button"
          disabled={!canDetect || locked}
          onClick={onDetect}
          type="button"
        >
          <Plus aria-hidden="true" />
          <span>Lesion detected</span>
        </button>
      </div>

      <div className="detection-audit" aria-live="polite">
        <div className="detection-count">
          <span>Recorded marks</span>
          <strong>{clickCount}</strong>
        </div>
        <ol className="detection-times" aria-label="Recorded lesion times">
          {clicks.length === 0 ? (
            <li className="detection-times__empty">No marks recorded</li>
          ) : (
            clicks.map((click) => (
              <li key={click.click_index}>
                <span className="detection-times__label">
                  Mark {click.click_index}
                </span>
                <time>{formatVideoTime(click.video_time_at_click)}</time>
                <button
                  aria-label={`Delete mark ${click.click_index}`}
                  className="detection-times__delete"
                  disabled={locked}
                  onClick={() => onDeleteMark(click.click_index)}
                  title={`Delete mark ${click.click_index}`}
                  type="button"
                >
                  <Trash2 aria-hidden="true" />
                  <span>Delete</span>
                </button>
              </li>
            ))
          )}
        </ol>
      </div>

      <div
        className="final-actions"
        data-has-next={canGoNext || (locked && clickCount > 0)}
      >
        <button
          className="no-lesion-button"
          disabled={!canReportNoLesion || locked}
          onClick={handleFinalizeNo}
          type="button"
        >
          <Ban aria-hidden="true" />
          <span>No lesion detected</span>
        </button>
        {(canGoNext || (locked && clickCount > 0)) && (
          <button
            className="next-video-button"
            disabled={!canGoNext || locked}
            onClick={handleFinalizeYes}
            type="button"
          >
            <span>Next video</span>
            <ArrowRight aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
}
