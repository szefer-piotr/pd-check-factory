import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import App from "../App";
import type { StepStatus } from "../services/stepApi";

const DONE_STATUSES: Record<string, StepStatus> = {
  "extract-inputs": "done",
  "index-protocol": "done",
  "acrf-split-toc": "done",
  "acrf-summary-text": "done",
  "extract-rules": "done",
  "extract-deviations": "done",
  "review-and-finalize": "pending"
};

vi.mock("../services/stepApi", () => ({
  fetchStudies: vi.fn(async () => ({
    studies: [
      {
        studyId: "MY-STUDY",
        protocolBlob: "raw/MY-STUDY/protocol.pdf",
        acrfBlob: "raw/MY-STUDY/acrf.pdf",
        stepStatuses: DONE_STATUSES,
        nextStepId: "review-and-finalize"
      }
    ]
  })),
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
  runStep: vi.fn(async (_studyId: string, stepId: string, _options?: { llmInstructions?: string }) => {
    const summaries: Record<string, string> = {
      "index-protocol": "Indexed 25 protocol paragraphs.",
      "acrf-split-toc": "Split aCRF markdown into 12 TOC section files.",
      "acrf-summary-text": "Merged aCRF summary text with 4 datasets.",
      "extract-rules": "Extracted 10 rules.",
      "extract-deviations": "Extracted 3 deviations and initialized review state."
    };
    return {
      studyId: "MY-STUDY",
      stepId,
      summary: summaries[stepId] ?? "Step complete.",
      stepStatuses: DONE_STATUSES
    };
  }),
  fetchStep7Deviations: vi.fn(async () => ({
    studyId: "MY-STUDY",
    columns: ["rule_id", "deviation_id", "rule_title", "deviation_text", "paragraph_refs", "pseudo_logic"],
    rows: [
      {
        rule_id: "rule-001",
        deviation_id: "dev-0001",
        rule_title: "Visit window timing",
        rule_text: "Visit must happen inside window",
        deviation_text: "Visit date outside window",
        paragraph_refs: ["p2"],
        paragraph_refs_text: "p2",
        supporting_sentences: [{ ref: "p2", text: "Visit 2 must occur within 7 days." }],
        data_support_note: "SV date supports this deviation",
        pseudo_logic: "SELECT 1",
        status: "to_review",
        dm_comment: "",
        entry_source: "extracted",
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
      rule_text: "Visit must happen inside window",
      deviation_text: "Visit date outside window refined",
      paragraph_refs: ["p2"],
      paragraph_refs_text: "p2",
      supporting_sentences: [{ ref: "p2", text: "Visit 2 must occur within 7 days." }],
      data_support_note: "SV date supports this deviation",
      pseudo_logic: "SELECT 1",
      status: "to_review",
      dm_comment: "please revise",
      entry_source: "extracted",
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
      rule_text: "Visit must happen inside window",
      deviation_text: "Visit date outside window",
      paragraph_refs: ["p2"],
      paragraph_refs_text: "p2",
      supporting_sentences: [{ ref: "p2", text: "Visit 2 must occur within 7 days." }],
      data_support_note: "SV date supports this deviation",
      pseudo_logic: "SELECT 1",
      status: "accepted",
      dm_comment: "",
      entry_source: "extracted",
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
      rule_text: "Visit must happen inside window",
      deviation_text: "Visit date outside window",
      paragraph_refs: ["p2"],
      paragraph_refs_text: "p2",
      supporting_sentences: [{ ref: "p2", text: "Visit 2 must occur within 7 days." }],
      data_support_note: "SV date supports this deviation",
      pseudo_logic: "SELECT generated FROM dm",
      status: "accepted",
      dm_comment: "",
      entry_source: "extracted",
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
        rule_text: "Visit must happen inside window",
        deviation_text: "Visit date outside window",
        paragraph_refs: ["p2"],
        paragraph_refs_text: "p2",
        supporting_sentences: [{ ref: "p2", text: "Visit 2 must occur within 7 days." }],
        data_support_note: "SV date supports this deviation",
        pseudo_logic: "SELECT bulk FROM dm",
        status: "accepted",
        dm_comment: "",
        entry_source: "extracted",
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
  createStep7Deviation: vi.fn(async () => ({
    studyId: "MY-STUDY",
    columns: ["rule_id", "deviation_id", "rule_title", "deviation_text", "paragraph_refs", "pseudo_logic"],
    rows: [
      {
        rule_id: "rule-001",
        deviation_id: "dev-manual",
        rule_title: "Visit window timing",
        rule_text: "Visit must happen inside window",
        deviation_text: "Manual deviation",
        paragraph_refs: ["p2"],
        paragraph_refs_text: "p2",
        supporting_sentences: [{ ref: "p2", text: "Visit 2 must occur within 7 days." }],
        data_support_note: "Manual support",
        pseudo_logic: "",
        status: "pending",
        dm_comment: "",
        entry_source: "imported",
        programmable: null,
        programmability_note: ""
      }
    ],
    stepStatuses: DONE_STATUSES
  })),
  deleteStep7Deviation: vi.fn(async () => ({
    studyId: "MY-STUDY",
    columns: ["rule_id", "deviation_id", "rule_title", "deviation_text", "paragraph_refs", "pseudo_logic"],
    rows: [],
    stepStatuses: DONE_STATUSES
  })),
  importStep7DeviationsWorkbook: vi.fn(async () => ({
    studyId: "MY-STUDY",
    imported: 1,
    columns: ["rule_id", "deviation_id", "rule_title", "deviation_text", "paragraph_refs", "pseudo_logic"],
    rows: [
      {
        rule_id: "rule-001",
        deviation_id: "dev-imported",
        rule_title: "Visit window timing",
        rule_text: "Visit must happen inside window",
        deviation_text: "Imported deviation",
        paragraph_refs: ["p2"],
        paragraph_refs_text: "p2",
        supporting_sentences: [],
        data_support_note: "Imported support",
        pseudo_logic: "",
        status: "pending",
        dm_comment: "",
        entry_source: "imported",
        programmable: null,
        programmability_note: ""
      }
    ],
    stepStatuses: DONE_STATUSES
  })),
  updateStep7Deviation: vi.fn(async () => ({
    studyId: "MY-STUDY",
    deviationId: "dev-0001",
    row: {
      rule_id: "rule-001",
      deviation_id: "dev-0001",
      rule_title: "Visit window timing",
      rule_text: "Visit must happen inside window",
      deviation_text: "Edited deviation",
      paragraph_refs: ["p2"],
      paragraph_refs_text: "p2",
      supporting_sentences: [],
      data_support_note: "",
      pseudo_logic: "",
      status: "pending",
      dm_comment: "",
      entry_source: "extracted",
      programmable: null,
      programmability_note: ""
    },
    stepStatuses: DONE_STATUSES
  })),
  createStep7Rule: vi.fn(async () => ({ studyId: "MY-STUDY", rule: { rule_id: "rule-new", title: "New rule", text: "" }, stepStatuses: DONE_STATUSES })),
  updateStep7Rule: vi.fn(async () => ({ studyId: "MY-STUDY", rule: { rule_id: "rule-001", title: "Edited rule", text: "Edited body" }, stepStatuses: DONE_STATUSES })),
  deleteStep7Rule: vi.fn(async () => ({ studyId: "MY-STUDY", deletedRuleId: "rule-unused", stepStatuses: DONE_STATUSES })),
  uploadStep1Files: vi.fn(),
  runStep1Extraction: vi.fn(async () => ({
    studyId: "MY-STUDY",
    message: "Extraction completed.",
    extractor: "document_intelligence",
    stepStatuses: {
      "extract-inputs": "done",
      "index-protocol": "pending",
      "acrf-split-toc": "pending",
      "acrf-summary-text": "pending",
      "extract-rules": "pending",
      "extract-deviations": "pending",
      "review-and-finalize": "pending"
    }
  })),
  fetchStep1Preview: vi.fn(async () => ({
    studyId: "MY-STUDY",
    protocolPreview: "Protocol preview",
    acrfPreview: "aCRF preview",
    protocolPreviewPath: "output/MY-STUDY/protocol/source.md",
    acrfPreviewPath: "output/MY-STUDY/acrf/source.md",
    protocolExists: true,
    acrfExists: true,
    extractor: "document_intelligence",
    stepStatuses: {
      "extract-inputs": "done",
      "index-protocol": "pending",
      "acrf-split-toc": "pending",
      "acrf-summary-text": "pending",
      "extract-rules": "pending",
      "extract-deviations": "pending",
      "review-and-finalize": "pending"
    }
  }))
}));

describe("Workflow pipeline pages", () => {
  beforeEach(async () => {
    window.location.hash = "";
    const stepApi = await import("../services/stepApi");
    vi.mocked(stepApi.runStep).mockClear();
    vi.mocked(stepApi.fetchStep7Deviations).mockClear();
    vi.mocked(stepApi.runStep1Extraction).mockClear();
    vi.mocked(stepApi.fetchStep1Preview).mockClear();
  });

  it("renders step navigation and default step panel", async () => {
    render(<App />);

    expect(await screen.findByText("1 blob project available")).toBeInTheDocument();
    expect(screen.getAllByText("Step 1 - Extract Inputs").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: "Extract" })).toBeInTheDocument();
    expect(screen.getByText("PDF extractor")).toBeInTheDocument();
  });

  it("switches to rule extraction page, shows preview, and runs backend step", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Step 5 - Rule Extractions/i }));
    expect(await screen.findByRole("heading", { name: "Preview" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Run this step" }));
    expect((await screen.findAllByText("Extracted 10 rules.")).length).toBeGreaterThan(0);
    expect(screen.getByText("Rules preview")).toBeInTheDocument();
  });

  it("shows Re-run when step is already done", async () => {
    const stepApi = await import("../services/stepApi");
    vi.mocked(stepApi.fetchStepPreview).mockResolvedValueOnce({
      studyId: "MY-STUDY",
      stepId: "extract-rules",
      previews: [{ title: "Rules preview", body: '{"rules":[]}', highlight: true }],
      stepStatuses: DONE_STATUSES
    });

    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Step 5 - Rule Extractions/i }));
    expect(await screen.findByRole("button", { name: "Re-run" })).toBeInTheDocument();
  });

  it("renders step 7 rule groups and drawer chat", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Step 7 - Review and Finalize/i }));
    expect(await screen.findByText("Visit window timing")).toBeInTheDocument();
    expect(screen.getByText("dev-0001")).toBeInTheDocument();

    await user.click(screen.getByText("dev-0001"));
    expect(await screen.findByRole("heading", { name: "dev-0001" })).toBeInTheDocument();
    expect(screen.getByText("Visit must happen inside window")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Decline" })).toBeInTheDocument();

    const input = screen.getByPlaceholderText(/Message the model/i);
    await user.clear(input);
    await user.type(input, "please revise");
    await user.click(screen.getByRole("button", { name: "Send" }));
    const transcript = screen.getByRole("log", { name: "Chat transcript" });
    expect(await within(transcript).findByText("Updated deviation from your message.")).toBeInTheDocument();
  });

  it("sends llmInstructions when running rule extraction", async () => {
    const stepApi = await import("../services/stepApi");
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Step 5 - Rule Extractions/i }));
    expect(await screen.findByRole("heading", { name: "Preview" })).toBeInTheDocument();

    await user.click(screen.getByText("Additional instructions for the model"));
    const textarea = screen.getByPlaceholderText(/Optional context/i);
    await user.type(textarea, "Emphasize dosing");
    await user.click(screen.getByRole("button", { name: "Run this step" }));

    await waitFor(() => {
      expect(stepApi.runStep).toHaveBeenCalled();
    });
    const call = vi.mocked(stepApi.runStep).mock.calls.find(([_, id]) => id === "extract-rules");
    expect(call).toBeDefined();
    expect(call![2]).toEqual({ llmInstructions: "Emphasize dosing" });
  });

  it("disables pseudo logic generation when no row is accepted, then enables it after acceptance", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Step 7 - Review and Finalize/i }));
    expect(await screen.findByText("Visit window timing")).toBeInTheDocument();

    const bulkButton = screen.getByRole("button", { name: /Generate all pseudo \(0\)/i });
    expect(bulkButton).toBeDisabled();

    await user.click(screen.getByText("dev-0001"));
    expect(await screen.findByRole("heading", { name: "dev-0001" })).toBeInTheDocument();

    const perRowButton = screen.getByRole("button", { name: "Generate pseudo logic" });
    expect(perRowButton).toBeDisabled();

    await user.click(screen.getByRole("button", { name: "Accept" }));
    expect(await screen.findByRole("button", { name: /Generate all pseudo \(1\)/i })).toBeEnabled();
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
          rule_text: "Visit must happen inside window",
          deviation_text: "Visit date outside window",
          paragraph_refs: ["p2"],
          paragraph_refs_text: "p2",
          supporting_sentences: [{ ref: "p2", text: "Visit 2 must occur within 7 days." }],
          data_support_note: "SV date supports this deviation",
          pseudo_logic: "",
          status: "accepted",
          dm_comment: "",
          entry_source: "extracted",
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
    expect(await screen.findByText("Visit window timing")).toBeInTheDocument();

    await user.click(screen.getByText("dev-0001"));
    expect(await screen.findByText("Not generated yet.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Generate all pseudo \(1\)/i }));
    expect(await screen.findByText("SELECT bulk FROM dm")).toBeInTheDocument();
    expect(screen.getByText(/Generated pseudo logic for 1 accepted deviation/i)).toBeInTheDocument();
    expect(stepApi.generateStep7PseudoLogicAll).toHaveBeenCalledWith("MY-STUDY");
  });

  it("adds manual deviations and imports Excel rows from Step 7", async () => {
    const stepApi = await import("../services/stepApi");
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Step 7 - Review and Finalize/i }));
    expect(await screen.findByText("Visit window timing")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "More actions" }));
    await user.type(screen.getByPlaceholderText("deviation_id"), "dev-manual");
    await user.type(screen.getAllByPlaceholderText("rule_id")[0], "rule-001");
    await user.type(screen.getByPlaceholderText("refs (p1, p2)"), "p2");
    await user.type(screen.getByPlaceholderText("deviation text"), "Manual deviation");
    await user.click(screen.getByRole("button", { name: "Add deviation" }));
    expect(await screen.findByText("Manual deviation")).toBeInTheDocument();
    expect(stepApi.createStep7Deviation).toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "More actions" }));
    const file = new File(["xlsx"], "deviations.xlsx", {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    });
    await user.upload(screen.getByLabelText("Choose Excel"), file);
    await user.click(screen.getByRole("button", { name: "Import deviations" }));
    expect(await screen.findByText("Imported deviation")).toBeInTheDocument();
    expect(stepApi.importStep7DeviationsWorkbook).toHaveBeenCalledWith("MY-STUDY", file);
  });

  it("runs backend steps in order and opens the DM revision grid", async () => {
    const stepApi = await import("../services/stepApi");
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Extract" }));
    expect(await screen.findByText(/Extraction completed/i)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Run to review" }));

    await waitFor(() => {
      expect(stepApi.runStep).toHaveBeenCalledTimes(5);
    });
    expect(vi.mocked(stepApi.runStep).mock.calls.map(([, stepId]) => stepId)).toEqual([
      "index-protocol",
      "acrf-split-toc",
      "acrf-summary-text",
      "extract-rules",
      "extract-deviations"
    ]);
    expect(await screen.findByText("Visit window timing")).toBeInTheDocument();
    expect(screen.getByText("Step 7 review is ready.")).toBeInTheDocument();
  });

  it("stops the automated run when a backend step fails", async () => {
    const stepApi = await import("../services/stepApi");
    vi.mocked(stepApi.runStep).mockImplementationOnce(async (_studyId: string, stepId: string) => ({
      studyId: "MY-STUDY",
      stepId,
      summary: "Indexed 25 protocol paragraphs.",
      stepStatuses: DONE_STATUSES
    }));
    vi.mocked(stepApi.runStep).mockRejectedValueOnce(new Error("Missing aCRF source markdown."));

    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "Extract" }));
    await user.click(await screen.findByRole("button", { name: "Run to review" }));

    expect((await screen.findAllByText("Missing aCRF source markdown.")).length).toBeGreaterThan(0);
    expect(stepApi.runStep).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Visit window timing")).not.toBeInTheDocument();
  });
});
