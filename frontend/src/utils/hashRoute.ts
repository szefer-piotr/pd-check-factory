import { navigateToPipelineStep } from "../pipeline/pipelineRoute";

/** Legacy deep-link helper — routes to the linear pipeline UI. */
export function navigateToStep(step: string, _options?: Record<string, string>): void {
  if (step.includes("upload") || step.includes("index-protocol") || step.includes("extract-pdf")) {
    navigateToPipelineStep("processing");
    return;
  }
  if (step.includes("acrf")) {
    navigateToPipelineStep("processing");
    return;
  }
  navigateToPipelineStep("review");
}

export function buildHash(step: string, _options?: Record<string, string>): string {
  if (step.includes("upload") || step.includes("index-protocol") || step.includes("extract-pdf")) {
    return "#/processing";
  }
  if (step.includes("acrf")) {
    return "#/processing";
  }
  return "#/review";
}
