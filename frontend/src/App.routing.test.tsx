import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppRouterTree } from "./App";
import * as stepApi from "./services/stepApi";

vi.mock("./services/stepApi", async (importOriginal) => {
  const actual = await importOriginal<typeof stepApi>();
  return {
    ...actual,
    fetchStudies: vi.fn(async () => ({ studies: [] })),
    createStudy: vi.fn(async (studyId: string) => ({
      studyId,
      manifestBlobPath: `pipeline/${studyId}/ui_upload_manifest.json`,
      uiStage: "project" as const
    })),
    fetchStudySummary: vi.fn(async (studyId: string) => ({
      studyId,
      workflow: null,
      uiStage: "project" as const,
      uploadStatus: {
        protocol: { uploaded: false, fileName: "protocol.pdf", size: 0, blob: "" },
        acrf: { uploaded: false, fileName: "acrf.pdf", size: 0, blob: "" },
        pdSpec: { uploaded: false, fileName: "pd_specifications.xlsx", size: 0, blob: "" },
        bothUploaded: false,
        allThreeUploaded: false,
        protocolPreprocessed: false,
        acrfPreprocessed: false,
        processingCoreComplete: false,
        processingComplete: false
      },
      stepStatuses: {},
      runState: { status: "idle" as const, currentSubStepId: "", llmProgress: null },
      deviationCounts: null,
      settings: {},
      lastModified: null
    })),
    fetchOpenAiDeployments: vi.fn(async () => ({
      deployments: [{ id: "gpt-4o", modelName: "gpt-4o", version: "1" }],
      defaultDeployment: "gpt-4o"
    })),
    setStudyWorkflow: vi.fn(async (studyId: string, workflow: stepApi.StudyWorkflow) => ({
      studyId,
      workflow,
      uiStage: "setup" as const,
      stepStatuses: {}
    })),
    fetchExtractionLive: vi.fn(async () => ({
      studyId: "TEST",
      rules: [],
      deviations: [],
      ruleCount: 0,
      deviationCount: 0,
      partial: false,
      completedRuleIds: [],
      llmProgress: null,
      runStatus: "idle" as const
    })),
    fetchStep1RunState: vi.fn(async (studyId: string) => ({
      studyId,
      status: "idle" as const,
      currentStage: "complete",
      currentSubStepId: "",
      message: "",
      error: "",
      startedAt: "",
      finishedAt: "",
      logs: [],
      llmProgress: null
    })),
    fetchStep7ReviewSources: vi.fn(async () => ({
      studyId: "TEST",
      sources: [],
      selectedSource: "generated" as const,
      stepStatuses: {}
    })),
    fetchStep7Deviations: vi.fn(async () => ({
      studyId: "TEST",
      reviewSource: "generated" as const,
      columns: [],
      rows: [],
      stepStatuses: {}
    })),
    syncStudy: vi.fn(async (studyId: string) => ({
      studyId,
      sync: { uploaded: 0, downloaded: 0, deleted: 0, skipped: 0 }
    }))
  };
});

function renderAt(path: string): ReturnType<typeof render> {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AppRouterTree />
    </MemoryRouter>
  );
}

describe("Rho PD Assurance routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows Welcome as the default screen without a study bar", async () => {
    renderAt("/welcome");
    expect(await screen.findByRole("heading", { name: "Rho PD Assurance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New Project/i })).toBeInTheDocument();
    expect(screen.queryByText("Sync")).not.toBeInTheDocument();
  });

  it("navigates to new project form without window.prompt", async () => {
    const user = userEvent.setup();
    renderAt("/welcome");
    await user.click(screen.getByRole("button", { name: /New Project/i }));
    expect(await screen.findByLabelText("Study ID")).toBeInTheDocument();
  });

  it("creates a project from the new project form", async () => {
    const user = userEvent.setup();
    renderAt("/projects/new");
    await user.type(screen.getByLabelText("Study ID"), "STUDY-NEW");
    await user.click(screen.getByRole("button", { name: /Create project/i }));
    await waitFor(() => {
      expect(stepApi.createStudy).toHaveBeenCalledWith("STUDY-NEW");
    });
    expect(await screen.findByText("Choose workflow")).toBeInTheDocument();
  });

  it("rejects study IDs containing slashes", async () => {
    const user = userEvent.setup();
    renderAt("/projects/new");
    await user.type(screen.getByLabelText("Study ID"), "bad/id");
    await user.click(screen.getByRole("button", { name: /Create project/i }));
    expect(await screen.findByText(/must not contain/i)).toBeInTheDocument();
    expect(stepApi.createStudy).not.toHaveBeenCalled();
  });

  it("opens project library from welcome", async () => {
    const user = userEvent.setup();
    vi.mocked(stepApi.fetchStudies).mockResolvedValueOnce({
      studies: [
        {
          studyId: "LIB-1",
          workflow: "extract",
          stage: "summary",
          lastModified: "2026-01-01T00:00:00Z"
        }
      ]
    });
    renderAt("/welcome");
    await user.click(screen.getByRole("button", { name: /Select from Project Library/i }));
    expect(await screen.findByRole("heading", { name: "Project Library" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "LIB-1" })).toBeInTheDocument();
  });

  it("shows an error when creating a duplicate study ID", async () => {
    const user = userEvent.setup();
    vi.mocked(stepApi.createStudy).mockRejectedValueOnce(new Error("Study 'DUPE' already exists"));
    renderAt("/projects/new");
    await user.type(screen.getByLabelText("Study ID"), "DUPE");
    await user.click(screen.getByRole("button", { name: /Create project/i }));
    expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    expect(stepApi.createStudy).toHaveBeenCalledWith("DUPE");
  });

  it("opens library study at the review stage route", async () => {
    const user = userEvent.setup();
    vi.mocked(stepApi.fetchStudies).mockResolvedValueOnce({
      studies: [
        {
          studyId: "LIB-REVIEW",
          workflow: "extract",
          stage: "review",
          lastModified: "2026-01-01T00:00:00Z"
        }
      ]
    });
    const completedReviewSummary = {
      studyId: "LIB-REVIEW",
      workflow: "extract" as const,
      uiStage: "review" as const,
      uploadStatus: {
        protocol: { uploaded: true, fileName: "protocol.pdf", size: 100, blob: "" },
        acrf: { uploaded: true, fileName: "acrf.pdf", size: 100, blob: "" },
        pdSpec: { uploaded: false, fileName: "pd_specifications.xlsx", size: 0, blob: "" },
        bothUploaded: true,
        allThreeUploaded: false,
        protocolPreprocessed: true,
        acrfPreprocessed: true,
        processingCoreComplete: true,
        processingComplete: true
      },
      stepStatuses: { "extract-deviations": "done" as const },
      runState: { status: "idle" as const, currentSubStepId: "", llmProgress: null },
      deviationCounts: { total: 0, accepted: 0, to_review: 0, rejected: 0 },
      settings: {},
      lastModified: "2026-01-01T00:00:00Z"
    };
    vi.mocked(stepApi.fetchStudySummary).mockResolvedValue(completedReviewSummary);
    vi.mocked(stepApi.fetchExtractionLive).mockResolvedValue({
      studyId: "LIB-REVIEW",
      rules: [],
      deviations: [],
      ruleCount: 0,
      deviationCount: 0,
      partial: false,
      completedRuleIds: [],
      llmProgress: null,
      runStatus: "idle"
    });
    renderAt("/welcome");
    await user.click(screen.getByRole("button", { name: /Select from Project Library/i }));
    await user.click(await screen.findByRole("button", { name: "LIB-REVIEW" }));
    expect(await screen.findByRole("heading", { name: "LIB-REVIEW" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: /Accept all/i })).toBeInTheDocument();
  });

  it("does not sync when opening a library study", async () => {
    const user = userEvent.setup();
    vi.mocked(stepApi.fetchStudies).mockResolvedValueOnce({
      studies: [
        {
          studyId: "LIB-NOSYNC",
          workflow: "extract",
          stage: "project",
          lastModified: "2026-01-01T00:00:00Z"
        }
      ]
    });
    renderAt("/welcome");
    await user.click(screen.getByRole("button", { name: /Select from Project Library/i }));
    await user.click(await screen.findByRole("button", { name: "LIB-NOSYNC" }));
    expect(await screen.findByText("Choose workflow")).toBeInTheDocument();
    expect(stepApi.syncStudy).not.toHaveBeenCalled();
    expect(stepApi.fetchStudySummary).toHaveBeenCalledWith("LIB-NOSYNC");
  });
});
