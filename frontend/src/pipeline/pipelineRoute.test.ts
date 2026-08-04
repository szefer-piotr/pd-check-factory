import { describe, expect, it } from "vitest";
import {
  canonicalizePipelineHash,
  parsePipelineHash,
  parsePipelineStepId,
  pipelineHashForStep
} from "./pipelineRoute";
import { PIPELINE_STEPS } from "./pipelineSteps";

describe("pipelineRoute", () => {
  it("maps legacy upload/extract routes to study-setup processing", () => {
    expect(parsePipelineHash("#/upload").stepId).toBe("study-setup");
    expect(parsePipelineHash("#/upload").section).toBe("processing");
    expect(parsePipelineHash("#/extract-pdfs").section).toBe("processing");
    expect(parsePipelineHash("#/processing").section).toBe("processing");
  });

  it("maps legacy rules/deviations/export routes", () => {
    expect(parsePipelineHash("#/extract-rules")).toEqual(
      expect.objectContaining({ stepId: "generate-pd", subStep: "rules" })
    );
    expect(parsePipelineHash("#/extract-deviations").subStep).toBe("deviations");
    expect(parsePipelineHash("#/export").stepId).toBe("review");
  });

  it("parses generate-pd child routes and study query", () => {
    expect(parsePipelineHash("#/generate-pd/rules?study=ABC")).toEqual({
      stepId: "generate-pd",
      subStep: "rules",
      studyId: "ABC"
    });
    expect(parsePipelineStepId("#/cost-analysis")).toBe("cost-analysis");
  });

  it("builds hashes for new IA", () => {
    expect(pipelineHashForStep("study-setup")).toBe("#/study-setup");
    expect(pipelineHashForStep("study-setup", { section: "processing", studyId: "S1" })).toBe(
      "#/study-setup/processing?study=S1"
    );
    expect(pipelineHashForStep("generate-pd", { subStep: "deviations" })).toBe("#/generate-pd/deviations");
    expect(PIPELINE_STEPS.map((step) => step.id)).toEqual([
      "study-setup",
      "generate-pd",
      "review",
      "cost-analysis"
    ]);
  });

  it("canonicalizes legacy hashes", () => {
    expect(canonicalizePipelineHash("#/export")).toBe("#/review");
    expect(canonicalizePipelineHash("#/extract-rules")).toBe("#/generate-pd/rules");
    expect(canonicalizePipelineHash("#/study-setup")).toBeNull();
  });
});
