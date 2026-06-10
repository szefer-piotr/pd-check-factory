import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { StudyProvider } from "../../context/StudyContext";
import * as stepApi from "../../services/stepApi";
import { createMockPipelineRunner } from "../../test/mockPipelineRunner";
import { PipelineStatusDrawer } from "./PipelineStatusDrawer";

vi.mock("../../services/stepApi", async (importOriginal) => {
  const actual = await importOriginal<typeof stepApi>();
  return {
    ...actual,
    fetchStepStatuses: vi.fn(async () => ({
      studyId: "S1",
      steps: [
        { stepId: "acrf-summary-text", status: "done" },
        { stepId: "extract-rules", status: "pending" }
      ],
      nextStepId: "extract-rules"
    })),
    fetchStep1RunState: vi.fn(async () => ({
      studyId: "S1",
      status: "done" as const,
      currentStage: "complete",
      currentSubStepId: "acrf-summary-text",
      message: "Done",
      error: "",
      startedAt: "",
      finishedAt: "",
      logs: [],
      llmProgress: null
    })),
    fetchStepPreview: vi.fn(async () => ({
      studyId: "S1",
      stepId: "extract-rules",
      previews: [],
      stepStatuses: {},
      partial: false,
      itemCount: 0
    }))
  };
});

function renderDrawer(runSingleStep = vi.fn(async () => undefined)): ReturnType<typeof render> {
  return render(
    <MemoryRouter>
      <StudyProvider
        value={{
          studyId: "S1",
          summary: {
            studyId: "S1",
            workflow: "extract",
            uiStage: "review",
            uploadStatus: {
              protocol: { uploaded: true, fileName: "p.pdf", size: 1, blob: "" },
              acrf: { uploaded: true, fileName: "a.pdf", size: 1, blob: "" },
              pdSpec: { uploaded: false, fileName: "", size: 0, blob: "" },
              bothUploaded: true,
              allThreeUploaded: false,
              protocolPreprocessed: true,
              acrfPreprocessed: true,
              processingCoreComplete: false,
              processingComplete: false
            },
            stepStatuses: { "acrf-summary-text": "done", "extract-rules": "pending" },
            runState: { status: "done", currentSubStepId: "acrf-summary-text", llmProgress: null },
            deviationCounts: null,
            settings: {},
            lastModified: null
          },
          isLoading: false,
          error: "",
          refresh: vi.fn(async () => undefined),
          pipelineRunner: createMockPipelineRunner({ runSingleStep })
        }}
      >
        <PipelineStatusDrawer />
      </StudyProvider>
    </MemoryRouter>
  );
}

describe("PipelineStatusDrawer", () => {
  it("renders pipeline steps and run remaining action", () => {
    renderDrawer();
    expect(screen.getByText(/Merge aCRF summary/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Run all remaining/i })).toBeInTheDocument();
  });

  it("re-run calls runSingleStep with force", async () => {
    const user = userEvent.setup();
    const runSingleStep = vi.fn(async () => undefined);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    renderDrawer(runSingleStep);

    const rerunButtons = screen.getAllByRole("button", { name: /Re-run/i });
    await user.click(rerunButtons[1]!);

    expect(runSingleStep).toHaveBeenCalledWith("index-protocol", { force: true });
  });
});
