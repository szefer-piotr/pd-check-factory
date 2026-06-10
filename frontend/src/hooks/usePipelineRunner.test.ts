import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as stepApi from "../services/stepApi";
import { usePipelineRunner } from "./usePipelineRunner";
import type { StudySettings } from "./useStudySettings";

vi.mock("../services/stepApi", async (importOriginal) => {
  const actual = await importOriginal<typeof stepApi>();
  return {
    ...actual,
    fetchStepStatuses: vi.fn(),
    fetchStep1RunState: vi.fn(),
    syncStudy: vi.fn(async () => ({ studyId: "S1", sync: { uploaded: 0, downloaded: 0, skipped: 0, errors: 0, errorMessages: [] }, stepStatuses: {} })),
    runStep: vi.fn(),
    runStep1Extraction: vi.fn(),
    setStep7ReviewDisplaySource: vi.fn(async () => ({
      studyId: "S1",
      sources: [],
      selectedSource: "generated" as const,
      stepStatuses: {}
    }))
  };
});

vi.mock("../utils/runExtractionPipeline", () => ({
  runExtractionPipeline: vi.fn(async () => ({ "extract-rules": "done" }))
}));

const settings: StudySettings = {
  protocolExtractor: "opendataloader",
  acrfExtractor: "document_intelligence",
  extractionLlmInstructions: "",
  extractionDeployment: "gpt-4o",
  acrfSummaryDeployment: "gpt-4o"
};

describe("usePipelineRunner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sessionStorage.clear();
    sessionStorage.setItem("pd-pipeline-auto-resume:S1", "1");
    vi.mocked(stepApi.fetchStepStatuses).mockResolvedValue({
      studyId: "S1",
      steps: [
        { stepId: "acrf-summary-text", status: "done" },
        { stepId: "extract-rules", status: "pending" }
      ],
      nextStepId: "extract-rules"
    });
    vi.mocked(stepApi.fetchStep1RunState).mockResolvedValue({
      studyId: "S1",
      status: "done",
      currentStage: "complete",
      currentSubStepId: "acrf-summary-text",
      message: "Done",
      error: "",
      startedAt: "",
      finishedAt: "",
      logs: [],
      llmProgress: null
    });
  });

  it("auto-resumes remaining steps when session flag is set", async () => {
    const refresh = vi.fn(async () => undefined);
    const { result } = renderHook(() => usePipelineRunner("S1", "extract", settings, refresh));

    await waitFor(() => {
      expect(stepApi.fetchStepStatuses).toHaveBeenCalled();
    });

    await waitFor(() => {
      expect(result.current.isRunning).toBe(false);
    });
  });
});
