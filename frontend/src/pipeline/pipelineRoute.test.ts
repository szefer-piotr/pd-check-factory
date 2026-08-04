import { describe, expect, it } from "vitest";
import { parsePipelineHash, pipelineHashForStep } from "./pipelineRoute";
import { LEGACY_PROCESSING_ROUTES, PIPELINE_STEPS } from "./pipelineSteps";

describe("pipelineRoute", () => {
  it("maps legacy upload/extract routes to processing", () => {
    for (const route of LEGACY_PROCESSING_ROUTES) {
      expect(parsePipelineHash(`#/${route}`)).toBe("processing");
    }
  });

  it("keeps current processing and rules routes", () => {
    expect(parsePipelineHash("#/processing")).toBe("processing");
    expect(parsePipelineHash("#/extract-rules")).toBe("extract-rules");
    expect(parsePipelineHash("#/study")).toBe("study");
  });

  it("builds hashes for collapsed step list", () => {
    expect(pipelineHashForStep("processing")).toBe("#/processing");
    expect(PIPELINE_STEPS.map((step) => step.id)).toEqual([
      "study",
      "config",
      "processing",
      "extract-rules",
      "extract-deviations",
      "review",
      "export",
      "cost-analysis"
    ]);
  });
});
