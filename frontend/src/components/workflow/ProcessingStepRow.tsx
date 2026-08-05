import { LlmProgressBar } from "./LlmProgressBar";
import { PipelineLogTicker } from "./PipelineLogTicker";
import type { LlmProgress, PipelineLogLine, StepStatus } from "../../services/stepApi";

const STEP_PHASE_MAP: Record<string, string[]> = {
  "acrf-summary-text": ["acrf-summary"],
  "extract-rules": ["extract-rules"],
  "extract-deviations": ["extract-deviations"],
  "normalize-checks": ["normalize-checks"],
  "classify-programmability": ["classify-programmability"],
  "import-pd-spec-enrich": ["pd-enrich"]
};

interface ProcessingStepRowProps {
  stepId: string;
  label: string;
  status: StepStatus;
  isRunning: boolean;
  isActiveStep: boolean;
  llmProgress: LlmProgress | null | undefined;
  stepLogs: PipelineLogLine[];
  runActive: boolean;
  onRun: () => void;
  onReRun: () => void;
  onPreview: () => void;
  actionsDisabled: boolean;
  previewLoading: boolean;
}

function statusIndicator(status: StepStatus, isRunning: boolean): string {
  if (isRunning) {
    return "running";
  }
  if (status === "done" || status === "skipped") {
    return "done";
  }
  return "pending";
}

export function ProcessingStepRow({
  stepId,
  label,
  status,
  isRunning,
  isActiveStep,
  llmProgress,
  stepLogs,
  runActive,
  onRun,
  onReRun,
  onPreview,
  actionsDisabled,
  previewLoading
}: ProcessingStepRowProps): JSX.Element {
  const indicator = statusIndicator(status, isRunning);
  const phases = STEP_PHASE_MAP[stepId] ?? [];
  const showProgress =
    isActiveStep &&
    llmProgress &&
    (phases.length === 0 || phases.includes(llmProgress.phase));

  return (
    <li className={`wizard-processing-step wizard-processing-step-${indicator}`}>
      <div className="wizard-processing-step-head">
        <div className="wizard-processing-step-title-row">
          <span className={`wizard-processing-step-indicator wizard-processing-step-indicator-${indicator}`} aria-hidden="true">
            {indicator === "done" ? "✓" : indicator === "running" ? "…" : ""}
          </span>
          <strong>{label}</strong>
        </div>
        <span className={`chip chip-${isRunning ? "running" : status}`}>{isRunning ? "running" : status}</span>
      </div>

      {showProgress ? <LlmProgressBar progress={llmProgress!} /> : null}

      {isActiveStep && runActive ? (
        <PipelineLogTicker logs={stepLogs} active className="wizard-processing-step-log" />
      ) : null}

      <div className="wizard-processing-step-actions">
        <button className="button button-primary" type="button" disabled={actionsDisabled} onClick={onRun}>
          Run
        </button>
        <button className="button button-secondary" type="button" disabled={actionsDisabled} onClick={onReRun}>
          Re-run
        </button>
        <button
          className="button button-secondary"
          type="button"
          disabled={previewLoading}
          onClick={onPreview}
        >
          Preview
        </button>
      </div>
    </li>
  );
}
