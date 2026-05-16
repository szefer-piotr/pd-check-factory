import { PROCESSING_BACKEND_STEP_IDS } from "../data/pipelineSteps";
import type { StepStatus } from "../services/stepApi";

export function isProcessingDone(backendStatuses: Record<string, StepStatus>): boolean {
  return PROCESSING_BACKEND_STEP_IDS.every((stepId) => backendStatuses[stepId] === "done");
}

export function deriveNavStatuses(backendStatuses: Record<string, StepStatus>): Record<string, StepStatus> {
  return {
    ...backendStatuses,
    processing: isProcessingDone(backendStatuses) ? "done" : "pending"
  };
}
