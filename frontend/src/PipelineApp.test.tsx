import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./services/stepApi", () => ({
  fetchStudies: vi.fn(async () => ({ studies: [] })),
  fetchOpenAiDeployments: vi.fn(async () => ({ deployments: [], defaultDeployment: "gpt-4o" })),
  fetchStepStatuses: vi.fn(async () => ({ studyId: "", steps: [], nextStepId: null })),
  fetchStep1UploadStatus: vi.fn(async () => ({
    studyId: "",
    protocol: { uploaded: false, fileName: "", size: 0, blob: "" },
    acrf: { uploaded: false, fileName: "", size: 0, blob: "" },
    pdSpec: { uploaded: false, fileName: "", size: 0, blob: "" },
    bothUploaded: false,
    stepStatuses: {}
  })),
  fetchStep1RunState: vi.fn(async () => ({
    studyId: "",
    status: "idle",
    currentStage: "",
    currentSubStepId: "",
    message: "",
    error: "",
    startedAt: "",
    finishedAt: "",
    logs: [],
    llmProgress: null,
    progress: null
  })),
  patchStudyManifest: vi.fn(async () => ({ studyId: "", manifest: {}, stage: "setup", workflow: "extract" })),
  createStudy: vi.fn(),
  resetStudy: vi.fn(),
  applyStudyRun: vi.fn(),
  fetchStudyRuns: vi.fn(async () => ({ studyId: "", activeRunId: "", runs: [] })),
  deleteAllStudies: vi.fn(),
  loadStudy: vi.fn(),
  preprocessProtocol: vi.fn(),
  preprocessAcrf: vi.fn(),
  uploadStep1File: vi.fn()
}));

vi.mock("./hooks/useStudySummary", () => ({
  useStudySummary: () => ({ summary: null, isLoading: false, refresh: vi.fn() })
}));

vi.mock("./hooks/useStudySettings", () => ({
  DEFAULT_SETTINGS: {
    extractorChoice: "document_intelligence",
    extractionLlmInstructions: "",
    extractionDeployment: "",
    acrfSummaryDeployment: "",
    chatDeployment: ""
  },
  applyDefaultDeployments: (settings: unknown) => settings,
  readGlobalLlmSettings: () => ({
    extractorChoice: "document_intelligence",
    extractionLlmInstructions: "",
    extractionDeployment: "",
    acrfSummaryDeployment: "",
    chatDeployment: ""
  }),
  writeGlobalLlmSettings: vi.fn(),
  useStudySettings: () => ({
    draftSettings: {
      extractorChoice: "document_intelligence",
      extractionLlmInstructions: "",
      extractionDeployment: "",
      acrfSummaryDeployment: "",
      chatDeployment: ""
    },
    appliedSettings: null,
    updateDraftSettings: vi.fn(),
    applySettings: vi.fn(),
    loadAppliedSettings: vi.fn(),
    hasAppliedSettings: false
  })
}));

import App from "./App";
import { PipelineApp } from "./PipelineApp";

describe("App shell", () => {
  it("defaults to Home with app sidebar destinations", () => {
    window.location.hash = "#/";
    render(<App />);
    expect(screen.getByRole("navigation", { name: "App" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Home" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Pipeline" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Guide" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start a study/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Reset study/i })).toBeInTheDocument();
    expect(screen.getByText(/clinical confidence/i)).toBeInTheDocument();
  });

  it("opens pipeline study setup from #/pipeline/study-setup", () => {
    window.location.hash = "#/pipeline/study-setup";
    render(<App />);
    expect(screen.getByRole("button", { name: "Pipeline" })).toHaveClass("active");
    expect(screen.getByRole("heading", { name: "Study selection" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Pipeline steps" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Activity/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Rules/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Deviations/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Study selection/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Configuration/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Document extraction/i })).toBeInTheDocument();
  });
});

describe("PipelineApp", () => {
  it("renders pipeline workspace and study setup", () => {
    window.location.hash = "#/pipeline/study-setup";
    render(<PipelineApp />);
    expect(screen.getByText("Pipeline")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Study selection" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Activity/i })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Start a new study" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Open an existing study" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Model configuration" })).not.toBeInTheDocument();
  });
});
