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
  fetchStep7Deviations: vi.fn(async () => ({
    studyId: "MY-STUDY",
    columns: ["rule_id", "deviation_id", "rule_title", "deviation_text", "paragraph_refs", "pseudo_logic"],
    rows: [
      {
        rule_id: "rule-001",
        deviation_id: "dev-0001",
        rule_title: "Visit window timing",
        deviation_text: "Visit date outside window",
        paragraph_refs: ["p2"],
        paragraph_refs_text: "p2",
        pseudo_logic: "SELECT 1",
        status: "to_review",
        dm_comment: "",
        programmable: true,
        programmability_note: "ok"
      }
    ],
    stepStatuses: {
      "extract-inputs": "done",
      "index-protocol": "done",
      "acrf-split-toc": "done",
      "acrf-summary-text": "done",
      "extract-rules": "done",
      "extract-deviations": "done",
      "review-and-finalize": "pending"
    }
  })),
  fetchStep7DeviationChat: vi.fn(async () => ({
    studyId: "MY-STUDY",
    deviationId: "dev-0001",
    messages: [{ role: "dm", text: "please revise", ts: "2026-01-01T00:00:00Z" }]
  })),
  refineStep7Deviation: vi.fn(async () => ({
    studyId: "MY-STUDY",
    deviationId: "dev-0001",
    row: {
      rule_id: "rule-001",
      deviation_id: "dev-0001",
      rule_title: "Visit window timing",
      deviation_text: "Visit date outside window refined",
      paragraph_refs: ["p2"],
      paragraph_refs_text: "p2",
      pseudo_logic: "SELECT 1",
      status: "to_review",
      dm_comment: "please revise",
      programmable: true,
      programmability_note: "ok"
    },
    messages: [
      { role: "dm", text: "please revise", ts: "2026-01-01T00:00:00Z" },
      { role: "assistant", text: "Updated deviation from your message.", ts: "2026-01-01T00:00:02Z" }
    ],
    audit: {},
    stepStatuses: {
      "extract-inputs": "done",
      "index-protocol": "done",
      "acrf-split-toc": "done",
      "acrf-summary-text": "done",
      "extract-rules": "done",
      "extract-deviations": "done",
      "review-and-finalize": "pending"
    }
  })),
  updateStep7DeviationStatus: vi.fn(async () => ({
    studyId: "MY-STUDY",
    deviationId: "dev-0001",
    row: {
      rule_id: "rule-001",
      deviation_id: "dev-0001",
      rule_title: "Visit window timing",
      deviation_text: "Visit date outside window",
      paragraph_refs: ["p2"],
      paragraph_refs_text: "p2",
      pseudo_logic: "SELECT 1",
      status: "accepted",
      dm_comment: "",
      programmable: true,
      programmability_note: "ok"
    },
    stepStatuses: {
      "extract-inputs": "done",
      "index-protocol": "done",
      "acrf-split-toc": "done",
      "acrf-summary-text": "done",
      "extract-rules": "done",
      "extract-deviations": "done",
      "review-and-finalize": "pending"
    }
  })),
  generateStep7PseudoLogic: vi.fn(async () => ({
    studyId: "MY-STUDY",
    deviationId: "dev-0001",
    row: {
      rule_id: "rule-001",
      deviation_id: "dev-0001",
      rule_title: "Visit window timing",
      deviation_text: "Visit date outside window",
      paragraph_refs: ["p2"],
      paragraph_refs_text: "p2",
      pseudo_logic: "SELECT generated FROM dm",
      status: "accepted",
      dm_comment: "",
      programmable: true,
      programmability_note: "ok"
    },
    stepStatuses: {
      "extract-inputs": "done",
      "index-protocol": "done",
      "acrf-split-toc": "done",
      "acrf-summary-text": "done",
      "extract-rules": "done",
      "extract-deviations": "done",
      "review-and-finalize": "pending"
    }
  })),
  generateStep7PseudoLogicAll: vi.fn(async () => ({
    studyId: "MY-STUDY",
    generated: 1,
    rows: [
      {
        rule_id: "rule-001",
        deviation_id: "dev-0001",
        rule_title: "Visit window timing",
        deviation_text: "Visit date outside window",
        paragraph_refs: ["p2"],
        paragraph_refs_text: "p2",
        pseudo_logic: "SELECT bulk FROM dm",
        status: "accepted",
        dm_comment: "",
        programmable: true,
        programmability_note: "ok"
      }
    ],
    stepStatuses: {
      "extract-inputs": "done",
      "index-protocol": "done",
      "acrf-split-toc": "done",
      "acrf-summary-text": "done",
      "extract-rules": "done",
      "extract-deviations": "done",
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
    expect(screen.getAllByText("Step 1 - Extract Inputs").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Collect protocol and aCRF files and produce normalized source markdown.").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Perform extraction" })).toBeInTheDocument();
  });

  it("switches to rule extraction page and runs backend step", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Step 5 - Rule Extractions/i }));
    expect((await screen.findAllByText("Generate atomic protocol rules with traceable references.")).length).toBeGreaterThan(0);

    await user.click(screen.getByRole("button", { name: "Run this step" }));
    expect(await screen.findByText("Extracted 10 rules.")).toBeInTheDocument();
  });

  it("renders step 7 excel-like table and refinement loop", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Step 7 - Review and Finalize/i }));
    expect(await screen.findByText("Step 7 Deviation Review Grid")).toBeInTheDocument();
    expect(screen.getByText("rule_id")).toBeInTheDocument();
    expect(screen.getByText("pseudo_logic")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("Refinement Loop: dev-0001")).toBeInTheDocument();

    const input = screen.getByPlaceholderText("Add DM instruction for this deviation...");
    await user.clear(input);
    await user.type(input, "please revise");
    await user.click(screen.getByRole("button", { name: "Send (refine)" }));
    expect(await screen.findByText("Updated deviation from your message.")).toBeInTheDocument();
  });

  it("disables pseudo logic generation when no row is accepted, then enables it after acceptance", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Step 7 - Review and Finalize/i }));
    expect(await screen.findByText("Step 7 Deviation Review Grid")).toBeInTheDocument();

    const bulkButton = screen.getByRole("button", { name: /Generate pseudo logic for all accepted/i });
    expect(bulkButton).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Open" }));
    expect(await screen.findByText("Refinement Loop: dev-0001")).toBeInTheDocument();

    const perRowButton = screen.getByRole("button", { name: "Generate pseudo logic" });
    expect(perRowButton).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByRole("button", { name: /Generate pseudo logic for all accepted \(1\)/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Generate pseudo logic" })).toBeEnabled();
  });

  it("refreshes rows after running bulk pseudo logic generation", async () => {
    const stepApi = await import("../services/stepApi");
    (stepApi.fetchStep7Deviations as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      studyId: "MY-STUDY",
      columns: ["rule_id", "deviation_id", "rule_title", "deviation_text", "paragraph_refs", "pseudo_logic"],
      rows: [
        {
          rule_id: "rule-001",
          deviation_id: "dev-0001",
          rule_title: "Visit window timing",
          deviation_text: "Visit date outside window",
          paragraph_refs: ["p2"],
          paragraph_refs_text: "p2",
          pseudo_logic: "",
          status: "accepted",
          dm_comment: "",
          programmable: null,
          programmability_note: ""
        }
      ],
      stepStatuses: {
        "extract-inputs": "done",
        "index-protocol": "done",
        "acrf-split-toc": "done",
        "acrf-summary-text": "done",
        "extract-rules": "done",
        "extract-deviations": "done",
        "review-and-finalize": "pending"
      }
    });

    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Step 7 - Review and Finalize/i }));
    expect(await screen.findByText("Step 7 Deviation Review Grid")).toBeInTheDocument();
    expect(screen.getByText("not generated")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Generate pseudo logic for all accepted/i }));
    expect(await screen.findByText("SELECT bulk FROM dm")).toBeInTheDocument();
    expect(screen.getByText(/Generated pseudo logic for 1 accepted deviation/i)).toBeInTheDocument();
    expect(stepApi.generateStep7PseudoLogicAll).toHaveBeenCalledWith("MY-STUDY");
  });
});
