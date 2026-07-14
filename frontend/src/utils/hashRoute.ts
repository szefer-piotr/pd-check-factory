import { navigateToPipelineStep } from "../pipeline/pipelineRoute";

/** Legacy deep-link helper — routes to the linear pipeline UI. */
export function navigateToStep(step: string, _options?: Record<string, string>): void {
  if (step.includes("upload")) {
    navigateToPipelineStep("upload");
    return;
  }
  if (step.includes("acrf")) {
    navigateToPipelineStep("acrf-summary");
    return;
  }
  navigateToPipelineStep("review");
}

export function buildHash(step: string, _options?: Record<string, string>): string {
  if (step.includes("upload")) {
    return "#/upload";
  }
  if (step.includes("acrf")) {
    return "#/acrf-summary";
  }
  return "#/review";
}
