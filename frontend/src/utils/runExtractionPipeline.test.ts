import { beforeEach, describe, expect, it, vi } from "vitest";
import * as stepApi from "../services/stepApi";
import { runExtractionPipeline } from "./runExtractionPipeline";

vi.mock("../services/stepApi", async (importOriginal) => {
  const actual = await importOriginal<typeof stepApi>();
  return {
    ...actual,
    fetchStepStatuses: vi.fn(),
    runStep: vi.fn(),
    runStep1Extraction: vi.fn()
  };
});

describe("runExtractionPipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(stepApi.fetchStepStatuses).mockResolvedValue({
      studyId: "S1",
      steps: [
        { stepId: "extract-inputs", status: "done" },
        { stepId: "index-protocol", status: "done" },
        { stepId: "acrf-split-toc", status: "done" },
        { stepId: "acrf-summary-text", status: "done" },
        { stepId: "extract-rules", status: "pending" },
        { stepId: "extract-deviations", status: "pending" }
      ],
      nextStepId: "extract-rules"
    });
    vi.mocked(stepApi.runStep).mockResolvedValue({
      studyId: "S1",
      stepId: "extract-rules",
      summary: "ok",
      stepStatuses: { "extract-rules": "done" }
    });
  });

  it("starts at fromStepId and skips earlier steps", async () => {
    const onStepStart = vi.fn();
    await runExtractionPipeline({
      studyId: "S1",
      workflow: "extract",
      protocolExtractor: "opendataloader",
      acrfExtractor: "document_intelligence",
      fromStepId: "extract-rules",
      onStepStart
    });

    expect(onStepStart).toHaveBeenCalledTimes(2);
    expect(onStepStart.mock.calls[0]?.[0]).toBe("extract-rules");
    expect(onStepStart.mock.calls[1]?.[0]).toBe("extract-deviations");
    expect(stepApi.runStep1Extraction).not.toHaveBeenCalled();
  });
});
