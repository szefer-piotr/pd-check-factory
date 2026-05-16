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
  llmInstructions?: string;
  onLlmInstructionsChange?: (value: string) => void;
}

const LLM_NOTE_STEPS = new Set(["extract-rules", "extract-deviations"]);

export function StepRunPanel({
  stepTitle,
  stepId,
  stepStatus,
  studyId,
  isRunning,
  runMessage,
  runError,
  onRun,
  llmInstructions = "",
  onLlmInstructionsChange
}: StepRunPanelProps): JSX.Element {
  const isDone = stepStatus === "done";
  const runLabel = isRunning ? "Running..." : isDone ? "Re-run" : "Run this step";
  const showLlmField = LLM_NOTE_STEPS.has(stepId);

  return (
    <section className="workflow-panel step-run-panel" aria-label={`Run ${stepTitle}`}>
      {showLlmField && onLlmInstructionsChange ? (
        <details className="step-run-llm-details">
          <summary className="step-run-llm-summary">Additional instructions for the model</summary>
          <textarea
            className="step-run-llm-textarea input"
            value={llmInstructions}
            onChange={(event) => onLlmInstructionsChange(event.target.value)}
            placeholder="Optional context or focus areas for extraction (prepended into the LLM user prompt)."
            rows={4}
          />
        </details>
      ) : null}
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
