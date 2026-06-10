import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PipelineProgressPanel } from "./PipelineProgressPanel";
import type { Step1RunStateResponse } from "../../services/stepApi";

const baseRunState: Step1RunStateResponse = {
  studyId: "RUNNING",
  status: "running",
  currentStage: "extract",
  currentSubStepId: "extract-inputs",
  message: "Reading protocol…",
  error: "",
  startedAt: "",
  finishedAt: "",
  logs: [{ ts: "t", level: "info", text: "Protocol OCR (di): page 1" }]
};

describe("PipelineProgressPanel", () => {
  it("renders OCR phase with spinner and reading protocol headline", () => {
    render(
      <PipelineProgressPanel
        runState={baseRunState}
        stepStatuses={{}}
        extractionComplete={false}
      />
    );
    expect(screen.getByText(/Extraction in progress/i)).toBeInTheDocument();
    expect(screen.getByText(/Reading protocol/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "OCR" })).toBeInTheDocument();
  });

  it("renders ACRF summary progress bar", () => {
    render(
      <PipelineProgressPanel
        runState={{
          ...baseRunState,
          currentSubStepId: "acrf-summary-text",
          llmProgress: {
            phase: "acrf-summary",
            current: 2,
            total: 5,
            unit: "sections"
          }
        }}
        stepStatuses={{}}
        extractionComplete={false}
        acrfSummaryDeployment="o4-mini"
      />
    );
    expect(screen.getByText(/ACRF summarizing — 2 \/ 5 sections/i)).toBeInTheDocument();
    expect(screen.getByText(/LLM: o4-mini/i)).toBeInTheDocument();
    expect(screen.getByText(/Summarizing 5 sections/i)).toBeInTheDocument();
  });

  it("renders rules counter during extract-rules", () => {
    render(
      <PipelineProgressPanel
        runState={{
          ...baseRunState,
          currentSubStepId: "extract-rules"
        }}
        stepStatuses={{}}
        extractionComplete={false}
        ruleCount={12}
        extractionDeployment="gpt-4o"
      />
    );
    expect(screen.getByText(/Extracting rules/i)).toBeInTheDocument();
    expect(screen.getByText("12")).toBeInTheDocument();
  });

  it("shows continue pipeline when stalled between steps", () => {
    const onContinue = vi.fn();
    render(
      <PipelineProgressPanel
        runState={{
          ...baseRunState,
          status: "done",
          currentSubStepId: "acrf-summary-text"
        }}
        stepStatuses={{ "acrf-summary-text": "done" }}
        extractionComplete={false}
        nextStepId="extract-rules"
        onContinuePipeline={onContinue}
      />
    );
    expect(screen.getByText(/Up next:/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Continue pipeline/i })).toBeInTheDocument();
    screen.getByRole("button", { name: /Continue pipeline/i }).click();
    expect(onContinue).toHaveBeenCalledTimes(1);
  });

  it("hides when extraction is complete", () => {
    const { container } = render(
      <PipelineProgressPanel
        runState={{
          ...baseRunState,
          status: "done"
        }}
        stepStatuses={{ "extract-deviations": "done" }}
        extractionComplete={true}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
