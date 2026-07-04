import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import * as stepApi from "../services/stepApi";

vi.mock("../services/stepApi", async (importOriginal) => {
  const actual = await importOriginal<typeof stepApi>();
  return {
    ...actual,
    fetchStudies: vi.fn(async () => ({
      studies: [
        {
          studyId: "EXISTING-STUDY",
          workflow: "extract" as const,
          workflowLabel: "Extract PD from protocol + aCRF",
          stage: "summary" as const,
          lastModified: "2026-06-01T12:00:00Z"
        }
      ]
    })),
    fetchOpenAiDeployments: vi.fn(async () => ({
      deployments: [{ id: "gpt-4o", modelName: "gpt-4o", version: "2024-08-06" }],
      defaultDeployment: "gpt-4o",
      source: "fallback"
    })),
    createStudy: vi.fn(async (studyId: string) => ({
      studyId,
      manifestBlobPath: `pipeline/${studyId}/ui_upload_manifest.json`
    })),
    fetchStudySummary: vi.fn(async (studyId: string) => ({
      studyId,
      workflow: studyId === "EXISTING-STUDY" ? "extract" : null,
      workflowLabel: "Extract PD from protocol + aCRF",
      stage: studyId === "EXISTING-STUDY" ? "summary" : "project",
      entryMode: "extracted" as const,
      uploads: {
        protocol: { uploaded: true, fileName: "protocol.pdf", size: 1000, blob: "" },
        acrf: { uploaded: true, fileName: "acrf.pdf", size: 1000, blob: "" },
        pdSpec: { uploaded: false, fileName: "pd_specifications.xlsx", size: 0, blob: "" }
      },
      bothUploaded: true,
      allThreeUploaded: false,
      preprocess: { protocol: true, acrf: true },
      processingComplete: false,
      runState: { studyId, status: "idle", logs: [] },
      steps: [],
      stepStatuses: {},
      nextStepId: "extract-inputs"
    })),
    patchStudyManifest: vi.fn(async (studyId: string, patch: { workflowChoice?: string }) => ({
      studyId,
      stage: "setup" as const,
      workflow: (patch.workflowChoice as stepApi.WorkflowChoice) ?? null
    })),
    syncStudy: vi.fn(),
    fetchStep1UploadStatus: vi.fn(async () => ({
      studyId: "NEW-STUDY",
      protocol: { uploaded: false, fileName: "protocol.pdf", size: 0, blob: "" },
      acrf: { uploaded: false, fileName: "acrf.pdf", size: 0, blob: "" },
      pdSpec: { uploaded: false, fileName: "pd_specifications.xlsx", size: 0, blob: "" },
      bothUploaded: false,
      allThreeUploaded: false,
      protocolPreprocessed: false,
      acrfPreprocessed: false,
      processingCoreComplete: false,
      processingComplete: false,
      stepStatuses: {}
    })),
    fetchStep1RunState: vi.fn(async (studyId: string) => ({
      studyId,
      status: "idle",
      currentStage: "",
      currentSubStepId: "",
      message: "",
      error: "",
      startedAt: "",
      finishedAt: "",
      logs: []
    })),
    fetchStudyRuns: vi.fn(async () => ({
      studyId: "",
      activeRunId: "",
      runs: []
    })),
    applyStudyRun: vi.fn(async () => ({
      studyId: "NEW-STUDY",
      runId: "run-test",
      fingerprint: "abc",
      created: true,
      settings: {
        extractorChoice: "both" as const,
        extractionDeployment: "gpt-4o",
        acrfSummaryDeployment: "gpt-4o",
        extractionLlmInstructions: ""
      },
      activeRunId: "run-test",
      runs: []
    })),
    activateStudyRun: vi.fn()
  };
});

describe("WizardShell", () => {
  beforeEach(() => {
    window.location.hash = "#/welcome";
  });

  it("renders welcome page with Rho PD Assurance branding", async () => {
    render(<App />);
    expect(await screen.findByRole("heading", { name: "Rho PD Assurance" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /New Project/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Project Library/i })).toBeInTheDocument();
  });

  it("opens library without calling syncStudy", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /Project Library/i }));
    expect(await screen.findByRole("heading", { name: "Project Library" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "EXISTING-STUDY" }));
    await waitFor(() => expect(stepApi.fetchStudySummary).toHaveBeenCalledWith("EXISTING-STUDY"));
    expect(await screen.findByRole("heading", { name: "Setup" })).toBeInTheDocument();
    expect(stepApi.syncStudy).not.toHaveBeenCalled();
  });

  it("validates study id on create", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("button", { name: /New Project/i }));
    const input = await screen.findByPlaceholderText(/STUDY-2026/i);
    await user.type(input, "bad/id");
    await user.click(screen.getByRole("button", { name: "Create project" }));
    expect(await screen.findByText(/path separators/i)).toBeInTheDocument();
    expect(stepApi.createStudy).not.toHaveBeenCalled();
  });
});
