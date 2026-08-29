import { describe, expect, it } from "vitest";
import {
  canonicalizePipelineHash,
  parsePipelineHash,
  parsePipelineStepId,
  pipelineHashForStep
} from "./pipelineRoute";
import { canonicalizeAppHash, parseAppHash } from "./appRoute";
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

  it("parses nested #/pipeline hashes", () => {
    expect(parsePipelineHash("#/pipeline/rules?study=S1")).toEqual({
      stepId: "rules",
      studyId: "S1"
    });
    expect(parsePipelineHash("#/pipeline/study-setup/config")).toEqual({
      stepId: "study-setup",
      section: "config",
      studyId: ""
    });
    expect(parsePipelineHash("#/pipeline")).toEqual({
      stepId: "study-setup",
      section: "study",
      studyId: ""
    });
  });

  it("builds hashes under #/pipeline", () => {
    expect(pipelineHashForStep("study-setup")).toBe("#/pipeline/study-setup");
    expect(pipelineHashForStep("study-setup", { section: "processing", studyId: "S1" })).toBe(
      "#/pipeline/study-setup/processing?study=S1"
    );
    expect(pipelineHashForStep("rules")).toBe("#/pipeline/rules");
    expect(pipelineHashForStep("deviations", { studyId: "S1" })).toBe(
      "#/pipeline/deviations?study=S1"
    );
    expect(PIPELINE_STEPS.map((step) => step.id)).toEqual([
      "study-setup",
      "rules",
      "deviations",
      "cost-analysis"
    ]);
  });

  it("canonicalizes legacy and bare pipeline hashes under #/pipeline", () => {
    expect(canonicalizePipelineHash("#/export")).toBe("#/pipeline/deviations");
    expect(canonicalizePipelineHash("#/extract-rules")).toBe("#/pipeline/rules");
    expect(canonicalizePipelineHash("#/generate-pd/deviations")).toBe("#/pipeline/deviations");
    expect(canonicalizePipelineHash("#/review")).toBe("#/pipeline/deviations");
    expect(canonicalizePipelineHash("#/rules")).toBe("#/pipeline/rules");
    expect(canonicalizePipelineHash("#/study-setup")).toBe("#/pipeline/study-setup");
    expect(canonicalizePipelineHash("#/pipeline/rules")).toBeNull();
  });
});

describe("appRoute", () => {
  it("defaults empty and unknown hashes to home", () => {
    expect(parseAppHash("").destination).toBe("home");
    expect(parseAppHash("#/").destination).toBe("home");
    expect(parseAppHash("#/home").destination).toBe("home");
    expect(parseAppHash("#/not-a-page").destination).toBe("home");
  });

  it("recognizes app destinations and pipeline routes", () => {
    expect(parseAppHash("#/guide").destination).toBe("guide");
    expect(parseAppHash("#/history").destination).toBe("history");
    expect(parseAppHash("#/settings").destination).toBe("settings");
    expect(parseAppHash("#/pipeline").destination).toBe("pipeline");
    expect(parseAppHash("#/rules").destination).toBe("pipeline");
    expect(parseAppHash("#/pipeline/deviations").pipeline?.stepId).toBe("deviations");
  });

  it("canonicalizes home alias", () => {
    expect(canonicalizeAppHash("#/home")).toBe("#/");
    expect(canonicalizeAppHash("#/guide")).toBeNull();
  });
});
