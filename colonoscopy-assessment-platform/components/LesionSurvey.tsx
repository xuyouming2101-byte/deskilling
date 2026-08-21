"use client";

import { useEffect, useMemo, useRef } from "react";
import { Model } from "survey-core";
import { Survey } from "survey-react-ui";
import type { LesionAnswer } from "@/lib/assessmentTypes";

type LesionSurveyProps = {
  clipId: string;
  canDetectLesion: boolean;
  canReportNoLesion: boolean;
  locked: boolean;
  onAnswer: (answer: LesionAnswer) => void;
};

type SurveyChoice = {
  value: unknown;
  setIsEnabled: (value: boolean) => void;
};

type LesionQuestion = {
  choices?: SurveyChoice[];
};

export default function LesionSurvey({
  clipId,
  canDetectLesion,
  canReportNoLesion,
  locked,
  onAnswer
}: LesionSurveyProps) {
  const submittedRef = useRef(false);

  const survey = useMemo(() => {
    const model = new Model({
      showQuestionNumbers: "off",
      showCompleteButton: false,
      showNavigationButtons: false,
      elements: [
        {
          type: "radiogroup",
          name: "lesionDetected",
          title: "Answer",
          isRequired: true,
          choices: [
            { value: "yes", text: "Lesion detected" },
            { value: "no", text: "No lesion detected" }
          ]
        }
      ]
    });

    model.focusFirstQuestionAutomatic = false;
    model.showCompletedPage = false;
    model.clearInvisibleValues = "none";

    return model;
  }, [clipId]);

  useEffect(() => {
    submittedRef.current = false;
    survey.clearValue("lesionDetected");
  }, [clipId, survey]);

  useEffect(() => {
    survey.mode = locked ? "display" : "edit";

    const question = survey.getQuestionByName(
      "lesionDetected"
    ) as LesionQuestion | null;

    for (const choice of question?.choices ?? []) {
      if (choice.value === "yes") {
        choice.setIsEnabled(canDetectLesion && !locked);
      }

      if (choice.value === "no") {
        choice.setIsEnabled(canReportNoLesion && !locked);
      }
    }
  }, [canDetectLesion, canReportNoLesion, locked, survey]);

  useEffect(() => {
    const handleValueChanged = (
      sender: Model,
      options: { name: string; value: unknown }
    ) => {
      if (options.name !== "lesionDetected" || submittedRef.current) {
        return;
      }

      if (options.value === "yes" && canDetectLesion) {
        submittedRef.current = true;
        sender.mode = "display";
        onAnswer("yes");
        return;
      }

      if (options.value === "no" && canReportNoLesion) {
        submittedRef.current = true;
        sender.mode = "display";
        onAnswer("no");
        return;
      }

      sender.clearValue("lesionDetected");
    };

    survey.onValueChanged.add(handleValueChanged);

    return () => {
      survey.onValueChanged.remove(handleValueChanged);
    };
  }, [canDetectLesion, canReportNoLesion, onAnswer, survey]);

  return (
    <div className="survey-shell">
      <Survey model={survey} />
    </div>
  );
}
