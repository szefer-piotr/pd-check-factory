import {
  IMPORT_GROUNDING_BACKEND_STEP_IDS,
  PROCESSING_BACKEND_STEP_IDS,
  PROCESSING_CORE_STEP_IDS
} from "../data/pipelineSteps";
import type { StepStatus } from "../services/stepApi";

export function isProcessingCoreDone(backendStatuses: Record<string, StepStatus>): boolean {
  return PROCESSING_CORE_STEP_IDS.every((stepId) => {
    const status = backendStatuses[stepId];
    return status === "done" || status === "skipped";
  });
}

/** All processing UI steps including rules and deviation extraction. */
export function isProcessingDone(backendStatuses: Record<string, StepStatus>): boolean {
  return PROCESSING_BACKEND_STEP_IDS.every((stepId) => {
    const status = backendStatuses[stepId];
    return status === "done" || status === "skipped";
  });
}

export function isImportGroundingDone(backendStatuses: Record<string, StepStatus>): boolean {
  return IMPORT_GROUNDING_BACKEND_STEP_IDS.every((stepId) => {
    const status = backendStatuses[stepId];
    return status === "done" || status === "skipped";
  });
}

export function deriveNavStatuses(
  backendStatuses: Record<string, StepStatus>,
  options?: { codingPhaseAccepted?: boolean }
): Record<string, StepStatus> {
  const codingAccepted = options?.codingPhaseAccepted === true;
  const reviewReachable =
    backendStatuses["extract-deviations"] === "done" ||
    backendStatuses["import-pd-spec-ground"] === "done" ||
    backendStatuses["import-pd-spec-map"] === "done" ||
    backendStatuses["import-pd-spec-enrich"] === "done";

  return {
    ...backendStatuses,
    processing: isProcessingDone(backendStatuses) ? "done" : "pending",
    "review-and-finalize": reviewReachable
      ? backendStatuses["review-and-finalize"] ?? "pending"
      : "pending",
    coding: codingAccepted ? "done" : "pending"
  };
}
