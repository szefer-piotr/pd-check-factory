import { describe, expect, it } from "vitest";
import type { StepStatus } from "../services/stepApi";
import { areStepDepsMet, getPipelineActionAccess, getPipelinePrimaryLabel } from "./pipelineActionAccess";

const DONE: StepStatus = "done";
const PENDING: StepStatus = "pending";

function statuses(overrides: Record<string, StepStatus>): Record<string, StepStatus> {
  return {
    "extract-inputs": DONE,
    "index-protocol": DONE,
    "acrf-split-toc": DONE,
    "acrf-summary-text": DONE,
    "extract-rules": DONE,
    "extract-deviations": DONE,
    "import-pd-spec-map": PENDING,
    "import-pd-spec-enrich": PENDING,
    ...overrides
  };
}

describe("areStepDepsMet", () => {
  it("returns true for import-pd-spec-map with no deps", () => {
    expect(areStepDepsMet("import-pd-spec-map", statuses({}))).toBe(true);
  });

  it("requires index-protocol and acrf-summary-text for enrich", () => {
    expect(
      areStepDepsMet(
        "import-pd-spec-enrich",
        statuses({ "index-protocol": PENDING, "acrf-summary-text": DONE })
      )
    ).toBe(false);
    expect(areStepDepsMet("import-pd-spec-enrich", statuses({}))).toBe(true);
  });
});

describe("getPipelineActionAccess", () => {
  it("enables pipeline when both PDFs uploaded and not busy", () => {
    const access = getPipelineActionAccess({
      bothUploaded: true,
      pdSpecUploaded: false,
      backendStatuses: statuses({}),
      isBusy: false
    });
    expect(access.pipeline.accessible).toBe(true);
    expect(access.map.accessible).toBe(false);
    expect(access.enrich.accessible).toBe(false);
    expect(access.map.blockReason).toMatch(/PD Specifications/i);
  });

  it("enables map when PD spec uploaded", () => {
    const access = getPipelineActionAccess({
      bothUploaded: true,
      pdSpecUploaded: true,
      backendStatuses: statuses({}),
      isBusy: false
    });
    expect(access.map.accessible).toBe(true);
    expect(access.enrich.accessible).toBe(true);
  });

  it("blocks enrich when index-protocol is pending", () => {
    const access = getPipelineActionAccess({
      bothUploaded: true,
      pdSpecUploaded: true,
      backendStatuses: statuses({ "index-protocol": PENDING }),
      isBusy: false
    });
    expect(access.enrich.accessible).toBe(false);
    expect(access.enrich.blockReason).toMatch(/indexing/i);
    expect(access.map.accessible).toBe(true);
  });

  it("shows canRerun when steps were completed", () => {
    const access = getPipelineActionAccess({
      bothUploaded: true,
      pdSpecUploaded: true,
      backendStatuses: statuses({
        "import-pd-spec-map": DONE,
        "import-pd-spec-enrich": DONE
      }),
      isBusy: false
    });
    expect(access.pipeline.canRerun).toBe(true);
    expect(access.map.canRerun).toBe(true);
    expect(access.enrich.canRerun).toBe(true);
  });

  it("disables all actions when busy", () => {
    const access = getPipelineActionAccess({
      bothUploaded: true,
      pdSpecUploaded: true,
      backendStatuses: statuses({}),
      isBusy: true
    });
    expect(access.pipeline.accessible).toBe(false);
    expect(access.map.accessible).toBe(false);
    expect(access.enrich.accessible).toBe(false);
  });
});

describe("getPipelinePrimaryLabel", () => {
  it("uses continue label when partial progress", () => {
    const label = getPipelinePrimaryLabel({
      bothUploaded: true,
      pdSpecUploaded: false,
      backendStatuses: statuses({ "extract-deviations": PENDING, "extract-rules": PENDING }),
      isBusy: false
    });
    expect(label).toBe("Continue pipeline to review");
  });
});
