import type { StudyWorkflow } from "../services/stepApi";

export const PROCESSING_SUB_STEPS = [
  "extract-inputs",
  "index-protocol",
  "acrf-split-toc",
  "acrf-summary-text",
  "extract-rules",
  "extract-deviations"
] as const;

export type ProcessingSubStepId = (typeof PROCESSING_SUB_STEPS)[number];

export const PROCESSING_STEP_LABELS: Record<ProcessingSubStepId, string> = {
  "extract-inputs": "Extract PDFs (OCR)",
  "index-protocol": "Index protocol",
  "acrf-split-toc": "Split aCRF TOC",
  "acrf-summary-text": "Merge aCRF summary",
  "extract-rules": "Extract rules",
  "extract-deviations": "Generate deviations"
};

export const IMPORT_STEP_LABELS: Record<string, string> = {
  "import-pd-spec-ground": "Import PD spec (ground)",
  "import-pd-spec-map": "Map PD spec to review",
  "import-pd-spec-enrich": "Enrich PD spec",
  "merge-pd-spec-imports": "Merge PD spec imports",
  "review-and-finalize": "Review and finalize"
};

export const ALL_STEP_LABELS: Record<string, string> = {
  ...PROCESSING_STEP_LABELS,
  ...IMPORT_STEP_LABELS,
  "preprocess-protocol": "Preprocess protocol",
  "preprocess-acrf": "Preprocess aCRF"
};

export function stepLabel(stepId: string): string {
  return ALL_STEP_LABELS[stepId] ?? stepId;
}

export type ProcessingStepStatus = "pending" | "running" | "done" | "failed" | "skipped";

export function getWorkflowSteps(workflow: StudyWorkflow | null | undefined): string[] {
  if (workflow === "map") {
    return ["import-pd-spec-map", "review-and-finalize"];
  }
  if (workflow === "enrich") {
    return [...PROCESSING_SUB_STEPS, "import-pd-spec-enrich", "review-and-finalize"];
  }
  return [...PROCESSING_SUB_STEPS, "review-and-finalize"];
}

export function isWorkflowExtractionComplete(
  workflow: StudyWorkflow | null | undefined,
  stepStatuses: Record<string, string>
): boolean {
  if (workflow === "map") {
    return stepStatuses["import-pd-spec-map"] === "done";
  }
  if (workflow === "enrich") {
    return stepStatuses["import-pd-spec-enrich"] === "done";
  }
  return (
    stepStatuses["extract-deviations"] === "done" || stepStatuses["extract-deviations"] === "skipped"
  );
}

export function deriveStepStatus(
  stepId: ProcessingSubStepId,
  runState: { status: string; currentSubStepId: string },
  stepStatuses: Record<string, string>
): ProcessingStepStatus {
  return derivePipelineStepStatus(stepId, runState, stepStatuses, PROCESSING_SUB_STEPS);
}

export function derivePipelineStepStatus(
  stepId: string,
  runState: { status: string; currentSubStepId: string },
  stepStatuses: Record<string, string>,
  orderedSteps: readonly string[] = PROCESSING_SUB_STEPS
): ProcessingStepStatus {
  const artifactStatus = stepStatuses[stepId];
  if (artifactStatus === "done") {
    return "done";
  }
  if (artifactStatus === "skipped") {
    return "skipped";
  }
  if (runState.status === "failed" && runState.currentSubStepId === stepId) {
    return "failed";
  }
  if (runState.status === "running" && runState.currentSubStepId === stepId) {
    return "running";
  }
  const currentIndex = orderedSteps.indexOf(runState.currentSubStepId);
  const stepIndex = orderedSteps.indexOf(stepId);
  if (currentIndex >= 0 && stepIndex >= 0 && stepIndex < currentIndex) {
    return "done";
  }
  if (runState.status === "done" && runState.currentSubStepId === stepId) {
    return "done";
  }
  return "pending";
}
