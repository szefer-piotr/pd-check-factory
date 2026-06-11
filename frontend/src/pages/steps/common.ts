import { BACKEND_STEP_LABELS } from "../../data/workflowSteps";
import type { StepDependencyInfo } from "../../components/workflow/StepPage";
import type { StepNavStatus } from "../../components/workflow/StepNavigation";
import type { Step1RunStateResponse, StepItemStatus, StepStatus } from "../../services/stepApi";

/** Shared props passed by the workflow shell to every routed step page. */
export interface WorkflowStepPageContext {
  studyId: string;
  /** Backend status entry for this route's backend step (when it has one). */
  stepInfo?: StepItemStatus;
  backendStatuses: Record<string, StepStatus>;
  runState: Step1RunStateResponse | null;
  /** True while this page's backend step is running (locally or per run state). */
  isStepRunning: boolean;
  runError: string;
  /** Run this page's backend step. */
  onRun: (force: boolean) => void;
  goPrev?: () => void;
  goNext?: () => void;
  prevLabel?: string;
  nextLabel?: string;
  /** ?focus= query param from the hash route. */
  focus?: string;
  /** ?tab= query param from the hash route. */
  tabParam?: string;
}

export function dependencyInfos(
  stepInfo: StepItemStatus | undefined,
  backendStatuses: Record<string, StepStatus>
): StepDependencyInfo[] {
  return (stepInfo?.dependencies ?? []).map((dependencyId) => ({
    stepId: dependencyId,
    label: BACKEND_STEP_LABELS[dependencyId] ?? dependencyId,
    done: backendStatuses[dependencyId] === "done" || backendStatuses[dependencyId] === "skipped"
  }));
}

export function stepNavStatus(
  stepInfo: StepItemStatus | undefined,
  isStepRunning: boolean,
  runFailed: boolean
): StepNavStatus {
  if (isStepRunning) {
    return "running";
  }
  if (runFailed) {
    return "failed";
  }
  return stepInfo?.status ?? "pending";
}

export function countDetail(stepInfo: StepItemStatus | undefined): string | undefined {
  if (stepInfo?.count === undefined || !stepInfo.unit) {
    return undefined;
  }
  return `${stepInfo.count} ${stepInfo.unit}`;
}

export function lastRunAtFor(
  runState: Step1RunStateResponse | null,
  backendStepId: string
): string | undefined {
  if (!runState || runState.currentSubStepId !== backendStepId || !runState.finishedAt) {
    return undefined;
  }
  return runState.finishedAt;
}
