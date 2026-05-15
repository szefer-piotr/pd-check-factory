import type { PipelineStepDefinition } from "../../types/pipeline";
import type { StepStatus } from "../../services/stepApi";

export type StepRuntimeStatus = "pending" | "running" | "done" | "failed";

export interface StepRuntimeState {
  status: StepRuntimeStatus;
  message: string;
}

interface StepNavigationProps {
  steps: PipelineStepDefinition[];
  activeStepId: string;
  statuses: Record<string, StepStatus>;
  runtimeStates?: Record<string, StepRuntimeState>;
  onSelectStep: (stepId: string) => void;
}

export function StepNavigation({ steps, activeStepId, statuses, runtimeStates = {}, onSelectStep }: StepNavigationProps): JSX.Element {
  return (
    <nav className="step-navigation" aria-label="Pipeline steps">
      {steps.map((step) => {
        const runtime = runtimeStates[step.id];
        const status = runtime?.status ?? statuses[step.id] ?? "pending";
        const message = runtime?.message || status;
        return (
          <button
            key={step.id}
            type="button"
            className={`step-nav-item step-nav-item-${status} ${step.id === activeStepId ? "step-nav-item-active" : ""}`}
            onClick={() => onSelectStep(step.id)}
          >
            <span className={`auto-run-circle auto-run-circle-${status}`} aria-hidden="true">
              {status === "failed" ? "!" : ""}
            </span>
            <span className="step-nav-title">{step.title}</span>
            <span className={`step-nav-status step-nav-status-${status}`}>{message}</span>
          </button>
        );
      })}
    </nav>
  );
}
