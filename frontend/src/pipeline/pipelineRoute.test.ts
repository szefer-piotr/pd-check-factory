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
      expect.objectContaining({ stepId: "rules" })
    );
    expect(parsePipelineHash("#/extract-deviations").stepId).toBe("deviations");
    expect(parsePipelineHash("#/export").stepId).toBe("deviations");
    expect(parsePipelineHash("#/review").stepId).toBe("deviations");
  });

  it("maps legacy generate-pd child routes and study query", () => {
    expect(parsePipelineHash("#/generate-pd/rules?study=ABC")).toEqual({
      stepId: "rules",
      studyId: "ABC"
    });
    expect(parsePipelineHash("#/generate-pd/deviations?study=ABC")).toEqual({
      stepId: "deviations",
      studyId: "ABC"
    });
    expect(parsePipelineStepId("#/cost-analysis")).toBe("cost-analysis");
  });

  it("builds hashes for new IA", () => {
    expect(pipelineHashForStep("study-setup")).toBe("#/study-setup");
    expect(pipelineHashForStep("study-setup", { section: "processing", studyId: "S1" })).toBe(
      "#/study-setup/processing?study=S1"
    );
    expect(pipelineHashForStep("rules")).toBe("#/rules");
    expect(pipelineHashForStep("deviations", { studyId: "S1" })).toBe("#/deviations?study=S1");
    expect(PIPELINE_STEPS.map((step) => step.id)).toEqual([
      "study-setup",
      "rules",
      "deviations",
      "cost-analysis"
    ]);
  });

  it("canonicalizes legacy hashes", () => {
    expect(canonicalizePipelineHash("#/export")).toBe("#/deviations");
    expect(canonicalizePipelineHash("#/extract-rules")).toBe("#/rules");
    expect(canonicalizePipelineHash("#/generate-pd/deviations")).toBe("#/deviations");
    expect(canonicalizePipelineHash("#/review")).toBe("#/deviations");
    expect(canonicalizePipelineHash("#/study-setup")).toBeNull();
  });
});
