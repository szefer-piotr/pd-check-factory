import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { StudySetupStepPage } from "./StudySetupStepPage";

vi.mock("./StudyStepPage", () => ({
  StudyStepPage: () => <div data-testid="study-stage">Study stage</div>
}));

vi.mock("./ConfigStepPage", () => ({
  ConfigStepPage: () => <div data-testid="config-stage">Config stage</div>
}));

vi.mock("./ProcessingStepPage", () => ({
  ProcessingStepPage: () => <div data-testid="processing-stage">Processing stage</div>
}));

vi.mock("../../pipeline/pipelineRoute", () => ({
  navigateToPipelineStep: vi.fn()
}));

const baseProps = {
  studyId: "TARA-001",
  onStudyIdChange: vi.fn(),
  settings: {
    extractorChoice: "document_intelligence" as const,
    extractionLlmInstructions: "",
    extractionDeployment: "gpt-4o",
    acrfSummaryDeployment: "gpt-4o",
    chatDeployment: "gpt-4o"
  },
  onSettingsChange: vi.fn(),
  onSaveConfig: vi.fn(),
  configSaved: true,
  processingComplete: false,
  deployments: [],
  deploymentsLoading: false,
  defaultDeployment: "gpt-4o",
  onStatusesChange: vi.fn(),
  onStudyCreated: vi.fn()
};

describe("StudySetupStepPage", () => {
  it("renders only the active setup section", () => {
    const { rerender } = render(<StudySetupStepPage {...baseProps} section="study" />);
    expect(screen.getByRole("heading", { name: "Study selection" })).toBeInTheDocument();
    expect(screen.getByTestId("study-stage")).toBeInTheDocument();
    expect(screen.queryByTestId("config-stage")).not.toBeInTheDocument();
    expect(screen.queryByTestId("processing-stage")).not.toBeInTheDocument();

    rerender(<StudySetupStepPage {...baseProps} section="config" />);
    expect(screen.getByRole("heading", { name: "Configuration" })).toBeInTheDocument();
    expect(screen.getByTestId("config-stage")).toBeInTheDocument();
    expect(screen.queryByTestId("study-stage")).not.toBeInTheDocument();
  });
});
