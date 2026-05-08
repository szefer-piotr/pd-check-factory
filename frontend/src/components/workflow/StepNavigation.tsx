import type { PipelineStepDefinition } from "../../types/pipeline";
import type { StepStatus } from "../../services/stepApi";

interface StepNavigationProps {
  steps: PipelineStepDefinition[];
  activeStepId: string;
  statuses: Record<string, StepStatus>;
  onSelectStep: (stepId: string) => void;
}

export function StepNavigation({ steps, activeStepId, statuses, onSelectStep }: StepNavigationProps): JSX.Element {
  return (
    <nav className="step-navigation" aria-label="Pipeline steps">
      {steps.map((step) => {
        const status = statuses[step.id] ?? "pending";
        return (
          <button
            key={step.id}
            type="button"
            className={`step-nav-item ${step.id === activeStepId ? "step-nav-item-active" : ""}`}
            onClick={() => onSelectStep(step.id)}
          >
            <span className="step-nav-title">{step.title}</span>
            <span className="step-nav-summary">{step.summary}</span>
            <span className={`step-nav-status step-nav-status-${status}`}>{status}</span>
          </button>
        );
      })}
    </nav>
  );
}
