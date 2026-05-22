import { PROCESSING_BACKEND_STEP_IDS } from "../../data/pipelineSteps";
import type { StepStatus } from "../../services/stepApi";

const STEP_LABELS: Record<(typeof PROCESSING_BACKEND_STEP_IDS)[number], string> = {
  "extract-inputs": "Extract PDFs",
  "index-protocol": "Index protocol",
  "acrf-split-toc": "Split aCRF sections",
  "acrf-summary-text": "Merge aCRF summary",
  "extract-rules": "Extract rules",
  "extract-deviations": "Extract deviations"
};

interface ProcessingStepStatusBarProps {
  backendStatuses: Record<string, StepStatus>;
  visible?: boolean;
}

export function ProcessingStepStatusBar({
  backendStatuses,
  visible = true
}: ProcessingStepStatusBarProps): JSX.Element | null {
  if (!visible) {
    return null;
  }

  return (
    <div className="processing-step-status-bar" aria-label="Processing step status">
      <h4 className="processing-step-status-bar-title">Pipeline progress</h4>
      <div className="auto-run-progress processing-step-status-grid" aria-live="polite">
        {PROCESSING_BACKEND_STEP_IDS.map((stepId) => {
          const status = backendStatuses[stepId];
          const isDone = status === "done" || status === "skipped";
          const circleClass = isDone ? "auto-run-circle-done" : "auto-run-circle-pending";
          return (
            <div className="auto-run-step" key={stepId}>
              <span className={`auto-run-circle ${circleClass}`} aria-hidden="true">
                {isDone ? "✓" : ""}
              </span>
              <div>
                <span className="auto-run-title">{STEP_LABELS[stepId]}</span>
                <span className="auto-run-message">{isDone ? "Complete" : "Not started"}</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
