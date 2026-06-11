import { stepsForPhase, WORKFLOW_PHASES, workflowStepById, type WorkflowPhaseId } from "../../data/workflowSteps";

export type StepNavStatus = "pending" | "running" | "done" | "failed" | "skipped";

export interface StepNavInfo {
  status: StepNavStatus;
  /** Chip subtitle, e.g. "42 rules" or "Running…". */
  subtitle?: string;
}

interface StepNavigationProps {
  activeStepId: string;
  /** Keyed by route id. */
  stepInfos: Record<string, StepNavInfo>;
  onSelectStep: (stepId: string) => void;
}

function phaseStatus(phase: WorkflowPhaseId, stepInfos: Record<string, StepNavInfo>): StepNavStatus {
  const steps = stepsForPhase(phase);
  const statuses = steps.map((step) => stepInfos[step.id]?.status ?? "pending");
  if (statuses.some((status) => status === "failed")) {
    return "failed";
  }
  if (statuses.some((status) => status === "running")) {
    return "running";
  }
  if (statuses.length > 0 && statuses.every((status) => status === "done" || status === "skipped")) {
    return "done";
  }
  return "pending";
}

/**
 * Two-level stepper: top row = phases (Processing / Review / Coding),
 * second row = sub-steps of the active phase. Every chip is always clickable.
 */
export function StepNavigation({ activeStepId, stepInfos, onSelectStep }: StepNavigationProps): JSX.Element {
  const activePhase = workflowStepById(activeStepId)?.phase ?? "processing";
  const subSteps = stepsForPhase(activePhase);

  return (
    <nav className="workflow-stepper" aria-label="Pipeline steps">
      <div className="workflow-stepper-phases" aria-label="Workflow phases">
        {WORKFLOW_PHASES.map((phase) => {
          const status = phaseStatus(phase.id, stepInfos);
          const isActive = phase.id === activePhase;
          return (
            <button
              key={phase.id}
              type="button"
              aria-current={isActive ? "step" : undefined}
              className={`phase-chip phase-chip-${status} ${isActive ? "phase-chip-active" : ""}`}
              onClick={() => {
                const first = stepsForPhase(phase.id)[0];
                if (first) {
                  onSelectStep(first.id);
                }
              }}
            >
              <span className={`auto-run-circle auto-run-circle-${status}`} aria-hidden="true">
                {status === "failed" ? "!" : status === "done" ? "✓" : ""}
              </span>
              <span className="phase-chip-title">{phase.title}</span>
            </button>
          );
        })}
      </div>
      {subSteps.length > 1 ? (
        <div className="workflow-stepper-substeps" aria-label={`${activePhase} sub-steps`}>
          {subSteps.map((step) => {
            const info = stepInfos[step.id];
            const status = info?.status ?? "pending";
            const isActive = step.id === activeStepId;
            return (
              <button
                key={step.id}
                type="button"
                aria-current={isActive ? "step" : undefined}
                className={`substep-chip substep-chip-${status} ${isActive ? "substep-chip-active" : ""}`}
                onClick={() => onSelectStep(step.id)}
              >
                <span className={`auto-run-circle auto-run-circle-${status}`} aria-hidden="true">
                  {status === "failed" ? "!" : status === "done" ? "✓" : ""}
                </span>
                <span className="substep-chip-text">
                  <span className="substep-chip-title">{step.shortTitle}</span>
                  {info?.subtitle ? <span className="substep-chip-subtitle">{info.subtitle}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </nav>
  );
}
