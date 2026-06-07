import type { PipelineStepDefinition } from "../../types/pipeline";
import type { StepStatus } from "../../services/stepApi";
import type { StepRuntimeState } from "./StepNavigation";

interface WorkflowPhaseNavProps {
  steps: PipelineStepDefinition[];
  activeStepId: string;
  statuses: Record<string, StepStatus>;
  runtimeStates?: Record<string, StepRuntimeState>;
  onSelectStep: (stepId: string) => void;
}

export function WorkflowPhaseNav({
  steps,
  activeStepId,
  statuses,
  runtimeStates = {},
  onSelectStep
}: WorkflowPhaseNavProps): JSX.Element {
  return (
    <nav className="workflow-phase-nav" aria-label="Workflow phases">
      {steps.map((step) => {
        const runtime = runtimeStates[step.id];
        const status = runtime?.status ?? statuses[step.id] ?? "pending";
        return (
          <button
            key={step.id}
            type="button"
            className={`workflow-phase-nav-item workflow-phase-nav-item-${status} ${
              step.id === activeStepId ? "workflow-phase-nav-item-active" : ""
            }`}
            onClick={() => onSelectStep(step.id)}
          >
            <span className={`auto-run-circle auto-run-circle-${status}`} aria-hidden="true">
              {status === "failed" ? "!" : ""}
            </span>
            <span className="workflow-phase-nav-title">{step.title}</span>
          </button>
        );
      })}
    </nav>
  );
}
