import { PROCESSING_BACKEND_STEP_IDS } from "../data/pipelineSteps";
import type { StepStatus } from "../services/stepApi";
import { isProcessingDone } from "./processingStatus";

/** Mirrors backend STEP_DEPENDENCIES for UI gating. */
export const STEP_DEPENDENCIES: Record<string, string[]> = {
  "extract-inputs": [],
  "index-protocol": ["extract-inputs"],
  "acrf-split-toc": ["extract-inputs"],
  "acrf-summary-text": ["acrf-split-toc"],
  "acrf-field-dictionary": ["acrf-summary-text"],
  "extract-rules": ["index-protocol"],
  "extract-deviations": ["extract-rules", "acrf-field-dictionary"],
  "normalize-checks": ["extract-deviations"],
  "deduplicate-checks": ["normalize-checks"],
  "classify-programmability": ["deduplicate-checks"],
  "import-pd-spec-ground": ["index-protocol", "acrf-field-dictionary"],
  "import-pd-spec-map": [],
  "import-pd-spec-enrich": ["index-protocol", "acrf-field-dictionary"],
  "merge-pd-spec-imports": ["import-pd-spec-ground"],
  "review-and-finalize": []
};

export type PipelineActionKey = "pipeline" | "map" | "enrich";

export interface PipelineActionAccess {
  accessible: boolean;
  canRerun: boolean;
  blockReason: string;
}

export interface PipelineActionAccessInput {
  bothUploaded: boolean;
  pdSpecUploaded: boolean;
  backendStatuses: Record<string, StepStatus>;
  isBusy: boolean;
  isProcessing?: boolean;
}

function stepDone(statuses: Record<string, StepStatus>, stepId: string): boolean {
  const status = statuses[stepId];
  return status === "done" || status === "skipped";
}

export function areStepDepsMet(stepId: string, backendStatuses: Record<string, StepStatus>): boolean {
  const deps = STEP_DEPENDENCIES[stepId] ?? [];
  return deps.every((dep) => stepDone(backendStatuses, dep));
}

function hasPartialPipelineProgress(
  bothUploaded: boolean,
  backendStatuses: Record<string, StepStatus>
): boolean {
  const processingDone = isProcessingDone(backendStatuses);
  if (!bothUploaded || processingDone) {
    return false;
  }
  return PROCESSING_BACKEND_STEP_IDS.some((stepId) => stepDone(backendStatuses, stepId));
}

export function getPipelinePrimaryLabel(input: PipelineActionAccessInput): string {
  const processingDone = isProcessingDone(input.backendStatuses);
  const hasPartialProgress = hasPartialPipelineProgress(input.bothUploaded, input.backendStatuses);
  const isProcessing = input.isProcessing === true;

  if (processingDone) {
    return isProcessing ? "Re-running…" : "Run pipeline to review";
  }
  if (hasPartialProgress) {
    return isProcessing ? "Continuing…" : "Continue pipeline to review";
  }
  return isProcessing ? "Running pipeline…" : "Run pipeline to review";
}

export function getPipelineActionAccess(input: PipelineActionAccessInput): Record<PipelineActionKey, PipelineActionAccess> {
  const { bothUploaded, pdSpecUploaded, backendStatuses, isBusy } = input;
  const processingDone = isProcessingDone(backendStatuses);
  const hasPartialProgress = hasPartialPipelineProgress(bothUploaded, backendStatuses);

  const pipelineBase = bothUploaded && !isBusy;
  let pipelineBlock = "";
  if (!bothUploaded) {
    pipelineBlock = "Upload protocol and annotated aCRF PDFs.";
  } else if (isBusy) {
    pipelineBlock = "Wait for the current operation to finish.";
  }

  const pipelinePreviouslyRun =
    processingDone ||
    hasPartialProgress ||
    stepDone(backendStatuses, "classify-programmability") ||
    stepDone(backendStatuses, "extract-rules");

  const mapBase = pdSpecUploaded && !isBusy;
  let mapBlock = "";
  if (!pdSpecUploaded) {
    mapBlock = "Upload the PD Specifications workbook (.xlsx).";
  } else if (isBusy) {
    mapBlock = "Wait for the current operation to finish.";
  }

  const enrichDepsMet = areStepDepsMet("import-pd-spec-enrich", backendStatuses);
  const enrichBase = pdSpecUploaded && enrichDepsMet && !isBusy;
  let enrichBlock = "";
  if (!pdSpecUploaded) {
    enrichBlock = "Upload the PD Specifications workbook (.xlsx).";
  } else if (!stepDone(backendStatuses, "index-protocol")) {
    enrichBlock = "Complete protocol indexing first (run pipeline or wait for background preparation).";
  } else if (!stepDone(backendStatuses, "acrf-field-dictionary")) {
    enrichBlock = "Complete aCRF field dictionary first (run pipeline or wait for background preparation).";
  } else if (isBusy) {
    enrichBlock = "Wait for the current operation to finish.";
  }

  return {
    pipeline: {
      accessible: pipelineBase,
      canRerun: pipelineBase && pipelinePreviouslyRun,
      blockReason: pipelineBlock
    },
    map: {
      accessible: mapBase,
      canRerun: mapBase && stepDone(backendStatuses, "import-pd-spec-map"),
      blockReason: mapBlock
    },
    enrich: {
      accessible: enrichBase,
      canRerun: enrichBase && stepDone(backendStatuses, "import-pd-spec-enrich"),
      blockReason: enrichBlock
    }
  };
}
