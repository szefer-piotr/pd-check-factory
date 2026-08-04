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

import { PipelineApp } from "./PipelineApp";

describe("PipelineApp", () => {
  it("renders pipeline shell and study setup", () => {
    window.location.hash = "#/study-setup";
    render(<PipelineApp />);
    expect(screen.getByText("PD Check Pipeline")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Study setup" })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Pipeline steps" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Activity/i })).toBeInTheDocument();
  });
});
