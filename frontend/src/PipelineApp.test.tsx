import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./services/stepApi", () => ({
  fetchStudies: vi.fn(async () => ({ studies: [] })),
  fetchOpenAiDeployments: vi.fn(async () => ({ deployments: [], defaultDeployment: "gpt-4o" })),
  fetchStepStatuses: vi.fn(async () => ({ studyId: "", steps: [], nextStepId: null })),
  patchStudyManifest: vi.fn(async () => ({ studyId: "", manifest: {}, stage: "setup", workflow: "extract" })),
  createStudy: vi.fn(),
  resetStudy: vi.fn(),
  applyStudyRun: vi.fn()
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
  it("renders pipeline shell and study step", () => {
    window.location.hash = "#/study";
    render(<PipelineApp />);
    expect(screen.getByText("PD Check Pipeline")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Study" })).toBeInTheDocument();
  });
});
