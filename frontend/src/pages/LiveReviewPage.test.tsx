import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { StudyProvider } from "../context/StudyContext";
import * as stepApi from "../services/stepApi";
import { createMockPipelineRunner } from "../test/mockPipelineRunner";
import { LiveReviewPage } from "./LiveReviewPage";

vi.mock("../services/stepApi", async (importOriginal) => {
  const actual = await importOriginal<typeof stepApi>();
  return {
    ...actual,
    fetchExtractionLive: vi.fn(async () => ({
      studyId: "RUNNING",
      rules: [],
      deviations: [],
      ruleCount: 0,
      deviationCount: 0,
      partial: true,
      completedRuleIds: [],
      llmProgress: null,
      runStatus: "running" as const
    })),
    fetchStep7ReviewSources: vi.fn(async () => ({
      studyId: "RUNNING",
      sources: [{ key: "generated", label: "Generated", available: true, rowCount: 0 }],
      selectedSource: "generated" as const,
      stepStatuses: {}
    })),
    fetchStep7Deviations: vi.fn(async () => ({
      studyId: "RUNNING",
      reviewSource: "generated" as const,
      columns: [],
      rows: [],
      stepStatuses: {}
    })),
    fetchStep1RunState: vi.fn(async () => ({
      studyId: "RUNNING",
      status: "running" as const,
      currentStage: "extract",
      currentSubStepId: "extract-inputs",
      message: "Reading protocol…",
      error: "",
      startedAt: "",
      finishedAt: "",
      logs: [{ ts: "t", level: "info" as const, text: "Starting extraction" }],
      llmProgress: null
    })),
    fetchStepStatuses: vi.fn(async () => ({
      studyId: "RUNNING",
      steps: [],
      nextStepId: "extract-rules"
    }))
  };
});

function renderReviewPage(
  summaryOverrides: Partial<NonNullable<Parameters<typeof StudyProvider>[0]["value"]>["summary"]> = {}
): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={["/projects/RUNNING/review"]}>
      <StudyProvider
        value={{
          studyId: "RUNNING",
          summary: {
            studyId: "RUNNING",
            workflow: "extract",
            uiStage: "review",
            uploadStatus: {
              protocol: { uploaded: true, fileName: "protocol.pdf", size: 1, blob: "" },
              acrf: { uploaded: true, fileName: "acrf.pdf", size: 1, blob: "" },
              pdSpec: { uploaded: false, fileName: "pd_specifications.xlsx", size: 0, blob: "" },
              bothUploaded: true,
              allThreeUploaded: false,
              protocolPreprocessed: true,
              acrfPreprocessed: true,
              processingCoreComplete: true,
              processingComplete: true
            },
            stepStatuses: { "extract-deviations": "pending" },
            runState: { status: "running", currentSubStepId: "extract-inputs", llmProgress: null },
            deviationCounts: null,
            settings: {},
            lastModified: null,
            ...summaryOverrides
          },
          isLoading: false,
          error: "",
          refresh: vi.fn(async () => undefined),
          pipelineRunner: createMockPipelineRunner()
        }}
      >
        <Routes>
          <Route path="/projects/:studyId/review" element={<LiveReviewPage />} />
        </Routes>
      </StudyProvider>
    </MemoryRouter>
  );
}

describe("LiveReviewPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows progress panel while extraction is running", async () => {
    renderReviewPage();
    expect(await screen.findByText(/Extraction in progress/i)).toBeInTheDocument();
    expect(screen.getByText(/Reading protocol/i)).toBeInTheDocument();
  });

  it("hides review panel while extraction is running", async () => {
    renderReviewPage();
    await screen.findByText(/Extraction in progress/i);
    expect(screen.queryByRole("button", { name: /Accept all/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Live extraction results/i)).not.toBeInTheDocument();
  });

  it("shows review panel when extraction is complete", async () => {
    vi.mocked(stepApi.fetchExtractionLive).mockResolvedValue({
      studyId: "DONE",
      rules: [],
      deviations: [],
      ruleCount: 2,
      deviationCount: 5,
      partial: false,
      completedRuleIds: ["rule-001", "rule-002"],
      llmProgress: null,
      runStatus: "done"
    });
    vi.mocked(stepApi.fetchStep1RunState).mockResolvedValue({
      studyId: "DONE",
      status: "done",
      currentStage: "complete",
      currentSubStepId: "extract-deviations",
      message: "Done",
      error: "",
      startedAt: "",
      finishedAt: "",
      logs: [],
      llmProgress: null
    });

    renderReviewPage({
      studyId: "DONE",
      stepStatuses: { "extract-deviations": "done" },
      runState: { status: "done", currentSubStepId: "extract-deviations", llmProgress: null }
    });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Accept all/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(/Extraction in progress/i)).not.toBeInTheDocument();
  });
});
