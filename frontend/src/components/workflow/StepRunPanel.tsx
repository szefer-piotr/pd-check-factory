import type { StepStatus } from "../../services/stepApi";

interface StepRunPanelProps {
  stepTitle: string;
  stepId: string;
  stepStatus: StepStatus;
  studyId: string;
  isRunning: boolean;
  runMessage: string;
  runError: string;
  onRun: () => void;
}

export function StepRunPanel({
  stepTitle,
  stepId,
  stepStatus,
  studyId,
  isRunning,
  runMessage,
  runError,
  onRun
}: StepRunPanelProps): JSX.Element {
  const isDone = stepStatus === "done";
  const runLabel = isRunning ? "Running..." : isDone ? "Re-run" : "Run this step";

  return (
    <section className="workflow-panel step-run-panel" aria-label={`Run ${stepTitle}`}>
      <div className="step-run-actions">
        <button
          className={`button ${isDone ? "button-secondary" : "button-primary"}`}
          type="button"
          onClick={onRun}
          disabled={isRunning || !studyId.trim()}
        >
          {runLabel}
        </button>
        {isDone && !isRunning ? (
          <span className="step-run-note">Outputs will be overwritten when you re-run.</span>
        ) : null}
      </div>
      {runMessage ? <p className="step1-status">{runMessage}</p> : null}
      {runError ? <p className="step1-error">{runError}</p> : null}
      {stepId === "acrf-split-toc" && runError.includes("No TOC rows found") ? (
        <p className="step1-note">
          Recovery: go to Step 1, select <strong>Auto (recommended)</strong>, re-run extraction, then run this step again.
        </p>
      ) : null}
    </section>
  );
}
