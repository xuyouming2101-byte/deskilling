type AssessmentDevDiagnosticsProps = {
  attemptId: string | null;
  currentVideoId: string | null;
  queueLength: number;
  source: "local" | "online";
};

function abbreviateAttemptId(attemptId: string | null) {
  return attemptId ? `${attemptId.slice(0, 8)}…` : "pending";
}

export function AssessmentDevBadge() {
  return <span className="dev-badge">DEV · LOCAL</span>;
}

export default function AssessmentDevDiagnostics({
  attemptId,
  currentVideoId,
  queueLength,
  source
}: AssessmentDevDiagnosticsProps) {
  return (
    <aside className="dev-diagnostics" aria-label="Developer diagnostics">
      <strong>Developer diagnostics</strong>
      <span>
        Persistent randomized queue · source {source} · database SQLite ·
        attempt {abbreviateAttemptId(attemptId)} · current item {currentVideoId ?? "pending"}
        {queueLength > 0 ? ` · queue ${queueLength}` : ""}
      </span>
    </aside>
  );
}
