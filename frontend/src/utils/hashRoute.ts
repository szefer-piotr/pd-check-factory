import { navigateToPipelineStep } from "../pipeline/pipelineRoute";

/** Legacy deep-link helper — routes to the linear pipeline UI. */
export function navigateToStep(step: string, _options?: Record<string, string>): void {
  if (step.includes("upload") || step.includes("index-protocol") || step.includes("extract-pdf") || step.includes("processing")) {
    navigateToPipelineStep("study-setup", { section: "processing" });
    return;
  }
  if (step.includes("acrf")) {
    navigateToPipelineStep("study-setup", { section: "processing" });
    return;
  }
  if (step.includes("extract-rules") || step === "rules") {
    navigateToPipelineStep("rules");
    return;
  }
  if (step.includes("extract-deviations") || step === "deviations") {
    navigateToPipelineStep("deviations");
    return;
  }
  navigateToPipelineStep("deviations");
}

export function buildHash(step: string, _options?: Record<string, string>): string {
  if (step.includes("upload") || step.includes("index-protocol") || step.includes("extract-pdf") || step.includes("processing")) {
    return "#/pipeline/study-setup/processing";
  }
  if (step.includes("acrf")) {
    return "#/pipeline/study-setup/processing";
  }
  if (step.includes("extract-rules") || step === "rules") {
    return "#/pipeline/rules";
  }
  if (step.includes("extract-deviations") || step === "deviations") {
    return "#/pipeline/deviations";
  }
  return "#/pipeline/deviations";
}
