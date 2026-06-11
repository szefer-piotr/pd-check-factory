import { WORKFLOW_STEP_IDS, type WorkflowChoice } from "../data/wizardSteps";
import type { StepStatus } from "../services/stepApi";

export function workflowStepsFor(choice: WorkflowChoice | null): string[] {
  if (!choice) {
    return [];
  }
  return WORKFLOW_STEP_IDS[choice];
}

export function isWorkflowComplete(
  choice: WorkflowChoice | null,
  statuses: Record<string, StepStatus>
): boolean {
  const steps = workflowStepsFor(choice);
  if (!steps.length) {
    return false;
  }
  return steps.every((stepId) => statuses[stepId] === "done" || statuses[stepId] === "skipped");
}

export function uploadsReadyForWorkflow(
  choice: WorkflowChoice | null,
  bothUploaded: boolean,
  allThreeUploaded: boolean
): boolean {
  if (choice === "extract") {
    return bothUploaded;
  }
  if (choice === "map" || choice === "enrich") {
    return allThreeUploaded;
  }
  return false;
}
