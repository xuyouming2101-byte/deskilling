"use client";

import { useMemo } from "react";
import AssessmentClient from "@/components/AssessmentClient";
import type {
  BrowserAssessmentGateway,
  BrowserVideoQueueItem
} from "@/lib/assessment/browserAssessmentGateway";

const fixtureQueue: BrowserVideoQueueItem[] = [
  { videoId: "video_fixture_001", videoOrder: 1 },
  { videoId: "video_fixture_002", videoOrder: 2 },
  { videoId: "video_fixture_003", videoOrder: 3 }
];

function createFixtureGateway(): BrowserAssessmentGateway {
  return {
    isConfigured: true,

    async startOrResume() {
      return {
        attemptId: "ui-parity-attempt",
        videoQueue: fixtureQueue,
        startIndex: 0,
        isComplete: false
      };
    },

    async loadCurrentVideo({ video }) {
      return {
        ...video,
        playbackUrl: "/ui-parity-fixture/fixture.mp4"
      };
    },

    async submitResponse(_attemptId, submission) {
      return {
        nextVideoOrder: submission.video_order + 1,
        isComplete: false
      };
    }
  };
}

export default function AssessmentUiParityHarness({
  deploymentMode
}: {
  deploymentMode: "local" | "online";
}) {
  const gateway = useMemo(() => createFixtureGateway(), []);

  return <AssessmentClient deploymentMode={deploymentMode} gateway={gateway} />;
}
