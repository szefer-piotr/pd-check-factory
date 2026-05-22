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
        bothUploaded: true,
        stepStatuses: DONE_STATUSES,
        nextStepId: "review-and-finalize"
      }
    ]
  })),
  syncStudy: vi.fn(async () => ({
    studyId: "MY-STUDY",
    sync: { uploaded: 0, downloaded: 0, skipped: 0, errors: 0, errorMessages: [] },
    stepStatuses: DONE_STATUSES
  })),
  deleteStudy: vi.fn(async () => ({
    studyId: "MY-STUDY",
    deletedBlobCount: 2,
    totalBlobCount: 2,
    blobPrefixes: ["raw/MY-STUDY/"],
    localOutputRemoved: true,
    message: "Deleted 2 blob object(s) for study 'MY-STUDY'."
  })),
  fetchStepStatuses: vi.fn(async () => ({
    studyId: "MY-STUDY",
    codingPhaseAccepted: false,
    steps: [
      { stepId: "extract-inputs", status: "done" },
      { stepId: "index-protocol", status: "done" },
      { stepId: "acrf-split-toc", status: "done" },
      { stepId: "acrf-summary-text", status: "done" },
      { stepId: "extract-rules", status: "done" },
      { stepId: "extract-deviations", status: "done" },
      { stepId: "review-and-finalize", status: "pending" }
    ],
    nextStepId: "review-and-finalize"
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
  acceptStep7DeviationsAll: vi.fn(async () => ({
    studyId: "MY-STUDY",
    accepted: 1,
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
  exportStep7DeviationsWorkbook: vi.fn(async () => ({
    blob: new Blob(["xlsx"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }),
    fileName: "MY-STUDY_deviations_review.xlsx"
  })),
  exportStep7DeviationsCodingWorkbook: vi.fn(async () => ({
    blob: new Blob(["coding-xlsx"], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    }),
    fileName: "MY-STUDY_company_pds.xlsx"
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
  uploadStep1File: vi.fn(async () => ({
    studyId: "MY-STUDY",
    protocolBlob: "raw/MY-STUDY/protocol.pdf",
    acrfBlob: "raw/MY-STUDY/acrf.pdf",
    protocolFileName: "protocol.pdf",
    acrfFileName: "acrf.pdf",
    protocolSize: 100,
    acrfSize: 100,
    bothUploaded: true,
    stepStatuses: DONE_STATUSES
  })),
  fetchStep1UploadStatus: vi.fn(async () => ({
    pdSpec: { uploaded: false, fileName: "pd_specifications.xlsx", size: 0, blob: "pipeline/MY-STUDY/imports/pd_specifications.xlsx" },
    studyId: "MY-STUDY",
    protocol: {
      uploaded: true,
      fileName: "protocol.pdf",
      size: 100,
      blob: "raw/MY-STUDY/protocol.pdf"
    },
    acrf: {
      uploaded: true,
      fileName: "acrf.pdf",
      size: 100,
      blob: "raw/MY-STUDY/acrf.pdf"
    },
    bothUploaded: true,
    allThreeUploaded: false,
    protocolPreprocessed: true,
    acrfPreprocessed: true,
    processingCoreComplete: true,
    processingComplete: true,
    stepStatuses: DONE_STATUSES
  })),
  preprocessProtocol: vi.fn(async () => ({
    studyId: "MY-STUDY",
    role: "protocol" as const,
    message: "Protocol ready",
    protocolPreprocessed: true,
    stepStatuses: DONE_STATUSES
  })),
  preprocessAcrf: vi.fn(async () => ({
    studyId: "MY-STUDY",
    role: "acrf" as const,
    message: "aCRF ready",
    acrfPreprocessed: true,
    stepStatuses: DONE_STATUSES
  })),
  uploadPdSpecWorkbook: vi.fn(async () => ({
    studyId: "MY-STUDY",
    pdSpecPath: "output/MY-STUDY/pipeline/imports/pd_specifications.xlsx",
    pdSpecBlob: "pipeline/MY-STUDY/imports/pd_specifications.xlsx",
    stepStatuses: DONE_STATUSES
  })),
  fetchStep1RunState: vi.fn(async () => ({
    studyId: "MY-STUDY",
    status: "idle",
    currentStage: "",
    currentSubStepId: "",
    message: "",
    error: "",
    startedAt: "",
    finishedAt: "",
    logs: []
  })),
  runStep1Extraction: vi.fn(async () => ({
    studyId: "MY-STUDY",
    message: "Extraction completed.",
    extractor: "document_intelligence",
    stepStatuses: DONE_STATUSES
  })),
  fetchStep1Preview: vi.fn(async () => ({
    studyId: "MY-STUDY",
    protocolPreview: "## Protocol preview",
    acrfPreview: "## aCRF preview",
    protocolFileName: "protocol.pdf",
    acrfFileName: "acrf.pdf",
    protocolPreviewPath: "output/MY-STUDY/protocol/source.md",
    acrfPreviewPath: "output/MY-STUDY/acrf/source.md",
    protocolExists: true,
    acrfExists: true,
    extractor: "document_intelligence",
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
  fetchSpecificationsPreview: vi.fn(async () => ({
    studyId: "MY-STUDY",
    sources: [
      {
        key: "review_state",
        label: "Active review state",
        rows: [
          {
            deviation_id: "dev-0001",
            rule_id: "rule-001",
            rule_title: "Visit window timing",
            deviation_text: "Visit date outside window",
            text: "Visit date outside window",
            entry_source: "extracted",
            status: "to_review"
          }
        ]
      }
    ],
    stepStatuses: DONE_STATUSES
  })),
  fetchImportVersions: vi.fn(async () => ({
    studyId: "MY-STUDY",
    activeDeviationsSource: null,
    importVersions: { imports: [], merged: [] },
    sources: []
  })),
  acceptCodingPhase: vi.fn(async () => ({
    studyId: "MY-STUDY",
    codingPhaseAccepted: true,
    codingPhaseAcceptedAt: "2026-01-01T00:00:00Z",
    stepStatuses: { ...DONE_STATUSES, "review-and-finalize": "done" }
  }))
}));

describe("Workflow pipeline pages", () => {
  beforeEach(async () => {
    window.location.hash = "";
    const stepApi = await import("../services/stepApi");
    vi.mocked(stepApi.runStep).mockReset();
    vi.mocked(stepApi.runStep).mockImplementation(async (_studyId: string, stepId: string) => ({
      studyId: "MY-STUDY",
      stepId,
      summary: `Completed ${stepId}.`,
      stepStatuses: DONE_STATUSES
    }));
    vi.mocked(stepApi.fetchStep7Deviations).mockClear();
    vi.mocked(stepApi.runStep1Extraction).mockClear();
    vi.mocked(stepApi.fetchStep1Preview).mockClear();
    vi.mocked(stepApi.fetchSpecificationsPreview).mockClear();
  });

  it("renders step navigation and default step panel", async () => {
    render(<App />);

    expect((await screen.findAllByText(/1 project in blob/)).length).toBeGreaterThan(0);
    expect(screen.getAllByText("Processing").length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /^Re-run$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Run pipeline to review/i })).not.toBeInTheDocument();
    expect(screen.getByText("Pipeline progress")).toBeInTheDocument();
    expect(screen.getByText("PD Specification")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Use ID" }).length).toBeGreaterThan(0);
    expect(screen.getAllByPlaceholderText(/Type a new project ID/i).length).toBeGreaterThan(0);
    const step1Picker = document.getElementById("workflow-blob-project-picker");
    expect(step1Picker).toBeInTheDocument();
    expect(within(step1Picker!.parentElement!.parentElement!).getByRole("option", { name: "MY-STUDY" })).toBeInTheDocument();
  });

  it("switches to a typed project id when Use ID is clicked", async () => {
    const user = userEvent.setup();
    render(<App />);

    const input = (await screen.findAllByPlaceholderText(/Type a new project ID/i))[0];
    await user.click(input);
    await user.keyboard("{Control>}a{/Control}");
    await user.keyboard("NEW-STUDY");
    await user.click(screen.getAllByRole("button", { name: "Use ID" })[0]);

    expect(input).toHaveValue("NEW-STUDY");
    expect((await screen.findAllByText(/Custom project/i)).length).toBeGreaterThan(0);
  });

  it("selects an existing blob project from the Step 1 dropdown", async () => {
    const user = userEvent.setup();
    render(<App />);

    const picker = await waitFor(() => {
      const element = document.getElementById("workflow-blob-project-picker") as HTMLSelectElement | null;
      if (!element || element.disabled) {
        throw new Error("picker not ready");
      }
      return element;
    });
    await user.selectOptions(picker, "MY-STUDY");
    expect(picker).toHaveValue("MY-STUDY");
  });

  it("exports current deviations from review", async () => {
    const stepApi = await import("../services/stepApi");
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const click = vi.fn();
    const createElement = vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const element = document.createElementNS("http://www.w3.org/1999/xhtml", tagName) as HTMLAnchorElement;
      if (tagName === "a") {
        element.click = click;
      }
      return element;
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: /Review and Finalize/i }));
    await user.click(screen.getByRole("button", { name: "Generate Excel" }));

    await waitFor(() => {
      expect(stepApi.exportStep7DeviationsWorkbook).toHaveBeenCalledWith("MY-STUDY");
    });
    expect(click).toHaveBeenCalled();
    expect(await screen.findByText(/Downloaded MY-STUDY_deviations_review\.xlsx/i)).toBeInTheDocument();

    createElement.mockRestore();
    vi.unstubAllGlobals();
  });

  it("exports company PDS workbook from Step 4 review", async () => {
    const stepApi = await import("../services/stepApi");
    const user = userEvent.setup();
    const createObjectURL = vi.fn(() => "blob:coding-export");
    const revokeObjectURL = vi.fn();
    vi.stubGlobal("URL", { createObjectURL, revokeObjectURL });

    const click = vi.fn();
    const createElement = vi.spyOn(document, "createElement").mockImplementation((tagName: string) => {
      const element = document.createElementNS("http://www.w3.org/1999/xhtml", tagName) as HTMLAnchorElement;
      if (tagName === "a") {
        element.click = click;
      }
      return element;
    });

    render(<App />);
    await user.click(screen.getByRole("button", { name: /Review and Finalize/i }));
    await user.click(screen.getByRole("button", { name: "Generate Company PDS" }));

    await waitFor(() => {
      expect(stepApi.exportStep7DeviationsCodingWorkbook).toHaveBeenCalledWith("MY-STUDY");
    });
    expect(click).toHaveBeenCalled();
    expect(await screen.findByText(/Downloaded MY-STUDY_company_pds\.xlsx/i)).toBeInTheDocument();

    createElement.mockRestore();
    vi.unstubAllGlobals();
  });

  it("renders step 7 rule groups and drawer chat", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Review and Finalize/i }));
    await screen.findByText("Specification preview");
    const devRow = await screen.findByRole("button", { name: /dev-0001/i });
    await user.click(devRow);
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

  it("shows Continue pipeline when some processing steps are already complete", async () => {
    const stepApi = await import("../services/stepApi");
    const partialStatuses: Record<string, StepStatus> = {
      "extract-inputs": "done",
      "index-protocol": "done",
      "acrf-split-toc": "pending",
      "acrf-summary-text": "pending",
      "extract-rules": "pending",
      "extract-deviations": "pending",
      "review-and-finalize": "pending"
    };
    vi.mocked(stepApi.fetchStudies).mockResolvedValueOnce({
      studies: [
        {
          studyId: "MY-STUDY",
          protocolBlob: "raw/MY-STUDY/protocol.pdf",
          acrfBlob: "raw/MY-STUDY/acrf.pdf",
          bothUploaded: true,
          stepStatuses: partialStatuses,
          nextStepId: "acrf-split-toc"
        }
      ]
    });
    vi.mocked(stepApi.syncStudy).mockResolvedValueOnce({
      studyId: "MY-STUDY",
      sync: { uploaded: 0, downloaded: 0, skipped: 0, errors: 0, errorMessages: [] },
      stepStatuses: partialStatuses
    });
    vi.mocked(stepApi.fetchStepStatuses).mockResolvedValueOnce({
      studyId: "MY-STUDY",
      codingPhaseAccepted: false,
      steps: Object.entries(partialStatuses).map(([stepId, status]) => ({ stepId, status })),
      nextStepId: "acrf-split-toc"
    });
    vi.mocked(stepApi.fetchStep1UploadStatus).mockResolvedValueOnce({
      studyId: "MY-STUDY",
      protocol: { uploaded: true, fileName: "protocol.pdf", size: 100, blob: "raw/MY-STUDY/protocol.pdf" },
      acrf: { uploaded: true, fileName: "acrf.pdf", size: 100, blob: "raw/MY-STUDY/acrf.pdf" },
      pdSpec: { uploaded: false, fileName: "pd_specifications.xlsx", size: 0, blob: "pipeline/MY-STUDY/imports/pd_specifications.xlsx" },
      bothUploaded: true,
      allThreeUploaded: false,
      protocolPreprocessed: true,
      acrfPreprocessed: false,
      processingCoreComplete: false,
      processingComplete: false,
      stepStatuses: partialStatuses
    });

    render(<App />);

    expect(await screen.findByRole("button", { name: /Continue pipeline to review/i })).toBeInTheDocument();
    const statusBar = screen.getByLabelText("Processing step status");
    expect(within(statusBar).getByText("Extract PDFs")).toBeInTheDocument();
    expect(within(statusBar).getAllByText("Complete").length).toBeGreaterThan(0);
    expect(within(statusBar).getAllByText("Not started").length).toBeGreaterThan(0);
  });

  it("sends llmInstructions when running the extraction pipeline", async () => {
    const stepApi = await import("../services/stepApi");
    const pendingStatuses: Record<string, StepStatus> = {
      "extract-inputs": "pending",
      "index-protocol": "pending",
      "acrf-split-toc": "pending",
      "acrf-summary-text": "pending",
      "extract-rules": "pending",
      "extract-deviations": "pending",
      "review-and-finalize": "pending"
    };
    const afterExtract: Record<string, StepStatus> = {
      "extract-inputs": "done",
      "index-protocol": "done",
      "acrf-split-toc": "done",
      "acrf-summary-text": "done",
      "extract-rules": "pending",
      "extract-deviations": "pending",
      "review-and-finalize": "pending"
    };
    vi.mocked(stepApi.fetchStudies).mockResolvedValueOnce({
      studies: [
        {
          studyId: "MY-STUDY",
          protocolBlob: "raw/MY-STUDY/protocol.pdf",
          acrfBlob: "raw/MY-STUDY/acrf.pdf",
          bothUploaded: true,
          stepStatuses: pendingStatuses,
          nextStepId: "extract-inputs"
        }
      ]
    });
    vi.mocked(stepApi.syncStudy).mockResolvedValueOnce({
      studyId: "MY-STUDY",
      sync: { uploaded: 0, downloaded: 0, skipped: 0, errors: 0, errorMessages: [] },
      stepStatuses: pendingStatuses
    });
    vi.mocked(stepApi.runStep1Extraction).mockResolvedValueOnce({
      studyId: "MY-STUDY",
      message: "Extraction completed.",
      extractor: "document_intelligence",
      stepStatuses: afterExtract
    });
    vi.mocked(stepApi.fetchStepStatuses).mockResolvedValueOnce({
      studyId: "MY-STUDY",
      codingPhaseAccepted: false,
      steps: Object.entries(pendingStatuses).map(([stepId, status]) => ({ stepId, status })),
      nextStepId: "extract-inputs"
    });
    vi.mocked(stepApi.fetchStep1UploadStatus).mockResolvedValueOnce({
      studyId: "MY-STUDY",
      protocol: { uploaded: true, fileName: "protocol.pdf", size: 1, blob: "raw/MY-STUDY/protocol.pdf" },
      acrf: { uploaded: true, fileName: "acrf.pdf", size: 1, blob: "raw/MY-STUDY/acrf.pdf" },
      pdSpec: { uploaded: false, fileName: "pd_specifications.xlsx", size: 0, blob: "pipeline/MY-STUDY/imports/pd_specifications.xlsx" },
      bothUploaded: true,
      stepStatuses: {
        "extract-inputs": "pending",
        "index-protocol": "pending",
        "acrf-split-toc": "pending",
        "acrf-summary-text": "pending",
        "extract-rules": "pending",
        "extract-deviations": "pending",
        "review-and-finalize": "pending"
      }
    });

    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByText("Advanced options"));
    const textarea = await screen.findByPlaceholderText(/Additional guidance for rule and deviation extraction/i);
    await user.type(textarea, "Emphasize dosing");
    const runBtn = await screen.findByRole("button", { name: /Run pipeline to review/i });
    await user.click(runBtn);

    await waitFor(() => {
      expect(stepApi.runStep).toHaveBeenCalled();
    });
    const call = vi.mocked(stepApi.runStep).mock.calls.find(([_, id]) => id === "extract-rules");
    expect(call).toBeDefined();
    expect(call![2]).toEqual({ llmInstructions: "Emphasize dosing", force: false });
  });

  it("accepts all pending deviations in bulk and enables pseudo generation", async () => {
    const stepApi = await import("../services/stepApi");
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Review and Finalize/i }));
    await screen.findByRole("button", { name: /dev-0001/i });

    const acceptAllButton = screen.getByRole("button", { name: /Accept all \(1\)/i });
    expect(screen.getByRole("button", { name: /Generate all pseudo \(0\)/i })).toBeDisabled();

    await user.click(acceptAllButton);
    expect(await screen.findByText(/Accepted 1 deviation/i)).toBeInTheDocument();
    expect(stepApi.acceptStep7DeviationsAll).toHaveBeenCalledWith("MY-STUDY");
    expect(await screen.findByRole("button", { name: /Generate all pseudo \(1\)/i })).toBeEnabled();
  });

  it("disables pseudo logic generation when no row is accepted, then enables it after acceptance", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Review and Finalize/i }));
    await screen.findByRole("button", { name: /dev-0001/i });

    const bulkButton = screen.getByRole("button", { name: /Generate all pseudo \(0\)/i });
    expect(bulkButton).toBeDisabled();

    await user.click(await screen.findByRole("button", { name: /dev-0001/i }));
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

    await user.click(screen.getByRole("button", { name: /Review and Finalize/i }));
    const devRow = await screen.findByRole("button", { name: /dev-0001/i });
    await user.click(devRow);
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

    await user.click(screen.getByRole("button", { name: /Review and Finalize/i }));
    await screen.findByRole("button", { name: /dev-0001/i });

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

  it("runs processing chain then opens review", async () => {
    const stepApi = await import("../services/stepApi");
    const pendingStatuses: Record<string, StepStatus> = {
      ...DONE_STATUSES,
      "extract-inputs": "pending",
      "extract-rules": "pending",
      "extract-deviations": "pending"
    };
    vi.mocked(stepApi.fetchStudies).mockResolvedValueOnce({
      studies: [
        {
          studyId: "MY-STUDY",
          protocolBlob: "raw/MY-STUDY/protocol.pdf",
          acrfBlob: "raw/MY-STUDY/acrf.pdf",
          bothUploaded: true,
          stepStatuses: pendingStatuses,
          nextStepId: "extract-inputs"
        }
      ]
    });
    const pendingSteps = Object.entries(pendingStatuses).map(([stepId, status]) => ({ stepId, status }));
    vi.mocked(stepApi.fetchStepStatuses).mockResolvedValueOnce({
      studyId: "MY-STUDY",
      codingPhaseAccepted: false,
      steps: pendingSteps
    });
    vi.mocked(stepApi.fetchStep1UploadStatus).mockResolvedValueOnce({
      studyId: "MY-STUDY",
      protocol: { uploaded: true, fileName: "protocol.pdf", size: 100, blob: "raw/MY-STUDY/protocol.pdf" },
      acrf: { uploaded: true, fileName: "acrf.pdf", size: 100, blob: "raw/MY-STUDY/acrf.pdf" },
      pdSpec: { uploaded: false, fileName: "pd_specifications.xlsx", size: 0, blob: "pipeline/MY-STUDY/imports/pd_specifications.xlsx" },
      bothUploaded: true,
      allThreeUploaded: false,
      protocolPreprocessed: true,
      acrfPreprocessed: true,
      stepStatuses: pendingStatuses
    });
    vi.mocked(stepApi.runStep1Extraction).mockResolvedValueOnce({
      studyId: "MY-STUDY",
      message: "Extraction completed.",
      extractor: "document_intelligence",
      stepStatuses: { ...pendingStatuses, "extract-inputs": "done" }
    });

    const user = userEvent.setup();
    render(<App />);

    const runProcessing = await screen.findByRole("button", { name: /Run pipeline to review/i });
    await waitFor(() => expect(runProcessing).toBeEnabled());
    await user.click(runProcessing);
    await waitFor(() => {
      expect(stepApi.runStep1Extraction).toHaveBeenCalled();
      expect(stepApi.runStep).toHaveBeenCalled();
    });

    await screen.findByText("Specification preview");
    await screen.findByRole("button", { name: /dev-0001/i });
  });

  it("shows PD spec action tiles when all three documents are uploaded", async () => {
    const stepApi = await import("../services/stepApi");
    vi.mocked(stepApi.fetchStep1UploadStatus).mockResolvedValue({
      studyId: "MY-STUDY",
      protocol: { uploaded: true, fileName: "protocol.pdf", size: 100, blob: "raw/MY-STUDY/protocol.pdf" },
      acrf: { uploaded: true, fileName: "acrf.pdf", size: 100, blob: "raw/MY-STUDY/acrf.pdf" },
      pdSpec: { uploaded: true, fileName: "specs.xlsx", size: 200, blob: "pipeline/MY-STUDY/imports/pd_specifications.xlsx" },
      bothUploaded: true,
      allThreeUploaded: true,
      protocolPreprocessed: true,
      acrfPreprocessed: true,
      stepStatuses: DONE_STATUSES
    });
    render(<App />);
    expect(await screen.findByRole("button", { name: /^Re-run$/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Map to review/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Enrich and open review/i })).toBeInTheDocument();
  });

  it("opens markdown preview in a modal when Preview is clicked", async () => {
    const stepApi = await import("../services/stepApi");
    vi.mocked(stepApi.fetchStep1Preview).mockImplementation(async (_studyId, _options?) => ({
      studyId: "MY-STUDY",
      protocolPreview: "## Inclusion\nSubject must be 18+",
      acrfPreview: "## Visit 3\nHemoglobin field",
      protocolPreviewPath: "output/MY-STUDY/protocol/source.md",
      acrfPreviewPath: "output/MY-STUDY/acrf/source.md",
      protocolExists: true,
      acrfExists: true,
      protocolFileName: "Protocol_v3_final.pdf",
      acrfFileName: "aCRF_annotated.pdf",
      extractor: "document_intelligence",
      stepStatuses: DONE_STATUSES
    }));
    vi.mocked(stepApi.fetchStep1UploadStatus).mockResolvedValue({
      studyId: "MY-STUDY",
      protocol: {
        uploaded: true,
        fileName: "Protocol_v3_final.pdf",
        size: 100,
        blob: "raw/MY-STUDY/protocol.pdf"
      },
      acrf: {
        uploaded: true,
        fileName: "aCRF_annotated.pdf",
        size: 100,
        blob: "raw/MY-STUDY/acrf.pdf"
      },
      pdSpec: { uploaded: false, fileName: "pd_specifications.xlsx", size: 0, blob: "pipeline/MY-STUDY/imports/pd_specifications.xlsx" },
      bothUploaded: true,
      stepStatuses: DONE_STATUSES
    });

    const user = userEvent.setup();
    render(<App />);

    const previewButtons = await screen.findAllByRole("button", { name: /Preview markdown/i });
    await user.click(previewButtons[0]);
    const dialog = await screen.findByRole("dialog", { name: /Protocol — extracted markdown/i });
    expect(within(dialog).getByRole("heading", { level: 2, name: "Inclusion" })).toBeInTheDocument();
    expect(stepApi.fetchStep1Preview).toHaveBeenCalledWith("MY-STUDY", { full: true });
  });

  it("deletes the active study after confirmation", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);

    render(<App />);

    const deleteButton = await screen.findByRole("button", { name: /delete study/i });
    await user.click(deleteButton);

    const stepApi = await import("../services/stepApi");
    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => {
      expect(stepApi.deleteStudy).toHaveBeenCalledWith("MY-STUDY");
    });
    expect(await screen.findByText(/Deleted 2 blob object/i)).toBeInTheDocument();

    confirmSpy.mockRestore();
  });

  it("disables Accept and continue when deviations are not all reviewed", async () => {
    const stepApi = await import("../services/stepApi");
    vi.mocked(stepApi.fetchStep7Deviations).mockResolvedValueOnce({
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
          supporting_sentences: [],
          data_support_note: "",
          pseudo_logic: "",
          status: "to_review",
          dm_comment: "",
          entry_source: "extracted",
          programmable: null,
          programmability_note: ""
        }
      ],
      stepStatuses: DONE_STATUSES
    });

    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /Review and Finalize/i }));
    expect(await screen.findByRole("button", { name: "Accept and continue to coding" })).toBeDisabled();
    expect(screen.getByText(/still pending or to review/i)).toBeInTheDocument();
  });

  it("accepts review and navigates to Step 5 coding", async () => {
    const stepApi = await import("../services/stepApi");
    vi.mocked(stepApi.fetchStep7Deviations).mockResolvedValueOnce({
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
          supporting_sentences: [],
          data_support_note: "",
          pseudo_logic: "SELECT 1",
          status: "accepted",
          dm_comment: "",
          entry_source: "extracted",
          programmable: true,
          programmability_note: "ok"
        }
      ],
      stepStatuses: DONE_STATUSES
    });

    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: /Review and Finalize/i }));
    const continueButton = await screen.findByRole("button", { name: "Accept and continue to coding" });
    await waitFor(() => expect(continueButton).toBeEnabled());
    await user.click(continueButton);

    await waitFor(() => {
      expect(stepApi.acceptCodingPhase).toHaveBeenCalledWith("MY-STUDY");
    });
    expect(await screen.findByText("Coding phase")).toBeInTheDocument();
    expect(screen.getByText("Coming soon")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Coding/i })).toBeInTheDocument();
  });
});
