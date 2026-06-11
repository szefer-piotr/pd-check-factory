/** First-class routed workflow steps: every backend sub-step is its own hash route. */

export type WorkflowPhaseId = "processing" | "review" | "coding";

export interface WorkflowPhaseDef {
  id: WorkflowPhaseId;
  title: string;
}

export interface WorkflowStepDef {
  /** Route id used in the URL hash. */
  id: string;
  title: string;
  /** Short label for the stepper chip. */
  shortTitle: string;
  phase: WorkflowPhaseId;
  /** Backend step id for /steps/status + /steps/{id}/run (when the route maps to one). */
  backendStepId?: string;
  description: string;
}

export const WORKFLOW_PHASES: WorkflowPhaseDef[] = [
  { id: "processing", title: "Processing" },
  { id: "review", title: "Review" },
  { id: "coding", title: "Coding" }
];

export const WORKFLOW_STEPS: WorkflowStepDef[] = [
  {
    id: "upload",
    title: "Upload PDFs",
    shortTitle: "Upload",
    phase: "processing",
    description: "Upload protocol and aCRF PDFs (and optionally a PD Specifications workbook)."
  },
  {
    id: "extract-inputs",
    title: "PDF → Markdown",
    shortTitle: "Extract",
    phase: "processing",
    backendStepId: "extract-inputs",
    description: "Extract both PDFs into markdown with OpenDataLoader and/or Document Intelligence."
  },
  {
    id: "index-protocol",
    title: "Paragraph index",
    shortTitle: "Index",
    phase: "processing",
    backendStepId: "index-protocol",
    description: "Number every protocol paragraph (p1, p2, …) for traceable rule references."
  },
  {
    id: "acrf-split-toc",
    title: "aCRF section split",
    shortTitle: "aCRF split",
    phase: "processing",
    backendStepId: "acrf-split-toc",
    description: "Split the aCRF markdown into per-section files using its table of contents."
  },
  {
    id: "acrf-summary-text",
    title: "Dataset summaries",
    shortTitle: "Datasets",
    phase: "processing",
    backendStepId: "acrf-summary-text",
    description: "Summarize each aCRF section into dataset/column structures via LLM."
  },
  {
    id: "extract-rules",
    title: "Rule extraction",
    shortTitle: "Rules",
    phase: "processing",
    backendStepId: "extract-rules",
    description: "Extract atomic protocol rules with paragraph references."
  },
  {
    id: "extract-deviations",
    title: "Deviation candidates",
    shortTitle: "Deviations",
    phase: "processing",
    backendStepId: "extract-deviations",
    description: "Generate candidate deviations per rule and initialize the review state."
  },
  {
    id: "review-and-finalize",
    title: "Review & Finalize",
    shortTitle: "Review",
    phase: "review",
    backendStepId: "review-and-finalize",
    description: "Review deviation decisions, refine pseudo-logic, and emit final outputs."
  },
  {
    id: "coding",
    title: "Coding",
    shortTitle: "Coding",
    phase: "coding",
    description: "Implement programmable checks once every deviation is resolved."
  }
];

export const DEFAULT_WORKFLOW_STEP_ID = WORKFLOW_STEPS[0].id;

/** Legacy hash routes redirected to the new first-class routes. */
export const LEGACY_WORKFLOW_HASH_REDIRECT: Record<string, string> = {
  processing: "upload"
};

export function workflowStepById(stepId: string): WorkflowStepDef | undefined {
  return WORKFLOW_STEPS.find((step) => step.id === stepId);
}

export function workflowStepIndex(stepId: string): number {
  return WORKFLOW_STEPS.findIndex((step) => step.id === stepId);
}

export function stepsForPhase(phase: WorkflowPhaseId): WorkflowStepDef[] {
  return WORKFLOW_STEPS.filter((step) => step.phase === phase);
}

/** Human labels for backend step ids (used in dependency lists / empty states). */
export const BACKEND_STEP_LABELS: Record<string, string> = {
  "extract-inputs": "PDF → Markdown",
  "index-protocol": "Paragraph index",
  "acrf-split-toc": "aCRF section split",
  "acrf-summary-text": "Dataset summaries",
  "extract-rules": "Rule extraction",
  "extract-deviations": "Deviation candidates",
  "import-pd-spec-ground": "Import & ground PD spec",
  "import-pd-spec-map": "Map PD spec",
  "import-pd-spec-enrich": "Enrich PD spec",
  "merge-pd-spec-imports": "Merge PD spec imports",
  "review-and-finalize": "Review & Finalize"
};
