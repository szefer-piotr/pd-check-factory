import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";

vi.mock("../services/stepApi", () => ({
  fetchStepStatuses: vi.fn(async () => ({
    studyId: "MY-STUDY",
    steps: [
      { stepId: "extract-inputs", status: "done" },
      { stepId: "index-protocol", status: "pending" },
      { stepId: "acrf-split-toc", status: "pending" },
      { stepId: "acrf-summary-text", status: "pending" },
      { stepId: "extract-rules", status: "pending" },
      { stepId: "extract-deviations", status: "pending" },
      { stepId: "review-and-finalize", status: "pending" }
    ],
    nextStepId: "index-protocol"
  })),
  fetchStepPreview: vi.fn(async () => ({
    studyId: "MY-STUDY",
    stepId: "extract-rules",
    previews: [{ title: "Rules preview", body: "rule-001", highlight: true }],
    stepStatuses: {
      "extract-inputs": "done",
      "index-protocol": "done",
      "acrf-split-toc": "done",
      "acrf-summary-text": "done",
      "extract-rules": "pending",
      "extract-deviations": "pending",
      "review-and-finalize": "pending"
    }
  })),
  runStep: vi.fn(async () => ({
    studyId: "MY-STUDY",
    stepId: "extract-rules",
    summary: "Extracted 10 rules.",
    stepStatuses: {
      "extract-inputs": "done",
      "index-protocol": "done",
      "acrf-split-toc": "done",
      "acrf-summary-text": "done",
      "extract-rules": "done",
      "extract-deviations": "pending",
      "review-and-finalize": "pending"
    }
  })),
  uploadStep1Files: vi.fn(),
  runStep1Extraction: vi.fn(),
  fetchStep1Preview: vi.fn()
}));

describe("Workflow pipeline pages", () => {
  it("renders step navigation and default step details", async () => {
    render(<App />);

    expect(await screen.findByText("PD Check Pipeline Pages")).toBeInTheDocument();
    expect(screen.getByText("Step 1 - Extract Inputs")).toBeInTheDocument();
    expect(screen.getByText("Input Sources")).toBeInTheDocument();
    expect(screen.getByText("Outputs Passed to Next Step")).toBeInTheDocument();
    expect(screen.getByText("Preview Results")).toBeInTheDocument();
  });

  it("switches to rule extraction page and runs backend step", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Step 5 - Rule Extractions/i }));
    expect(await screen.findByText("Generate atomic protocol rules with traceable references.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Run this step" }));
    expect(await screen.findByText("Extracted 10 rules.")).toBeInTheDocument();
  });
});
