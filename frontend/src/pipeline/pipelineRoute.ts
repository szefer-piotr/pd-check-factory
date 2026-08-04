import type { PipelineStepId } from "./pipelineSteps";
import { LEGACY_PROCESSING_ROUTES, PIPELINE_STEPS, pipelineStepByRoute } from "./pipelineSteps";

const DEFAULT_ROUTE = "study";

export function parsePipelineHash(hash: string): PipelineStepId {
  const trimmed = hash.replace(/^#\/?/, "").trim();
  const route = trimmed.split("?")[0]?.split("/")[0] ?? DEFAULT_ROUTE;
  if (LEGACY_PROCESSING_ROUTES.has(route)) {
    return "processing";
  }
  const step = pipelineStepByRoute(route);
  return step?.id ?? "study";
}

export function pipelineHashForStep(stepId: PipelineStepId): string {
  const step = PIPELINE_STEPS.find((item) => item.id === stepId);
  return `#/${step?.route ?? DEFAULT_ROUTE}`;
}

export function navigateToPipelineStep(stepId: PipelineStepId): void {
  const next = pipelineHashForStep(stepId);
  if (window.location.hash !== next) {
    window.location.hash = next;
  }
}
