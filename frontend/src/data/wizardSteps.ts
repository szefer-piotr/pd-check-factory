/** Guided wizard stages for Rho PD Assurance. */

export type WizardStageId =
  | "welcome"
  | "library"
  | "project"
  | "setup"
  | "summary"
  | "processing"
  | "review";

export type WorkflowChoice = "extract" | "map" | "enrich";

export interface WizardStageDef {
  id: WizardStageId;
  title: string;
  shortTitle: string;
  /** Shown in the linear stepper (excludes welcome/library). */
  showInStepper: boolean;
}

export const WIZARD_STAGES: WizardStageDef[] = [
  { id: "welcome", title: "Welcome", shortTitle: "Welcome", showInStepper: false },
  { id: "library", title: "Project Library", shortTitle: "Library", showInStepper: false },
  { id: "project", title: "Project", shortTitle: "Project", showInStepper: true },
  { id: "setup", title: "Setup", shortTitle: "Setup", showInStepper: true },
  { id: "summary", title: "Summary", shortTitle: "Summary", showInStepper: false },
  { id: "processing", title: "Processing", shortTitle: "Processing", showInStepper: true },
  { id: "review", title: "Review", shortTitle: "Review", showInStepper: true }
];

export const DEFAULT_WIZARD_STAGE: WizardStageId = "welcome";

export const STEPPER_STAGES = WIZARD_STAGES.filter((stage) => stage.showInStepper);

export const WORKFLOW_TILES: Array<{
  choice: WorkflowChoice;
  title: string;
  description: string;
}> = [
  {
    choice: "extract",
    title: "Extract PD from protocol + aCRF",
    description:
      "Run the full pipeline: PDF extraction, protocol index, aCRF summary, rule extraction, and deviation candidates."
  },
  {
    choice: "enrich",
    title: "Enrich PD Specifications",
    description:
      "Run parallel protocol and aCRF analysis to refine deviation logic, surface caveats, and flag weak spots."
  },
  {
    choice: "map",
    title: "Map uploaded PD Specifications to Review",
    description: "Map the uploaded PD Specifications workbook to the Review page (imported lane)."
  }
];

export const WORKFLOW_STEP_IDS: Record<WorkflowChoice, string[]> = {
  extract: [
    "extract-inputs",
    "index-protocol",
    "acrf-split-toc",
    "acrf-summary-text",
    "acrf-field-dictionary",
    "extract-rules",
    "extract-deviations",
    "normalize-checks",
    "deduplicate-checks",
    "classify-programmability",
    "review-and-finalize"
  ],
  map: ["import-pd-spec-map", "merge-pd-spec-imports", "review-and-finalize"],
  enrich: [
    "extract-inputs",
    "index-protocol",
    "acrf-split-toc",
    "acrf-summary-text",
    "acrf-field-dictionary",
    "import-pd-spec-enrich",
    "merge-pd-spec-imports",
    "review-and-finalize"
  ]
};

export const WORKFLOW_LABELS: Record<WorkflowChoice, string> = {
  extract: "Extract PD from protocol + aCRF",
  map: "Map uploaded PD Specifications to Review",
  enrich: "Enrich PD Specifications"
};

export const BACKEND_STEP_LABELS: Record<string, string> = {
  "extract-inputs": "PDF → Markdown",
  "index-protocol": "Paragraph index",
  "acrf-split-toc": "aCRF section split",
  "acrf-summary-text": "Dataset summaries",
  "acrf-field-dictionary": "Field dictionary",
  "extract-rules": "Rule extraction",
  "extract-deviations": "Deviation candidates",
  "normalize-checks": "Normalize checks",
  "deduplicate-checks": "Deduplicate checks",
  "classify-programmability": "Classify programmability",
  "import-pd-spec-ground": "Import & ground PD spec",
  "import-pd-spec-map": "Map PD spec",
  "import-pd-spec-enrich": "Enrich PD spec",
  "merge-pd-spec-imports": "Merge PD spec imports",
  "review-and-finalize": "Review & Finalize"
};

export function wizardStageById(stageId: string): WizardStageDef | undefined {
  return WIZARD_STAGES.find((stage) => stage.id === stageId);
}

export function wizardStageIndex(stageId: WizardStageId): number {
  return WIZARD_STAGES.findIndex((stage) => stage.id === stageId);
}

export function reviewSourceForWorkflow(workflow: WorkflowChoice | null | undefined): "generated" | "imported_pd_spec" | "enriched_pd_spec" {
  if (workflow === "map") {
    return "imported_pd_spec";
  }
  if (workflow === "enrich") {
    return "enriched_pd_spec";
  }
  return "generated";
}
