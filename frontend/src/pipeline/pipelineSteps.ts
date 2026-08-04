/** Linear extract-only pipeline steps (one UI page each). */

export type PipelineStepId =
  | "study"
  | "config"
  | "processing"
  | "extract-rules"
  | "extract-deviations"
  | "review"
  | "export"
  | "cost-analysis";

export interface PipelineStepDef {
  id: PipelineStepId;
  route: string;
  title: string;
  shortTitle: string;
  description: string;
  /** Backend step id used for run/status, if any. */
  backendStepId?: string;
}

export const PIPELINE_STEPS: PipelineStepDef[] = [
  {
    id: "study",
    route: "study",
    title: "Study",
    shortTitle: "Study",
    description: "Create a new study or select an existing one."
  },
  {
    id: "config",
    route: "config",
    title: "Model configuration",
    shortTitle: "Config",
    description: "Choose Azure OpenAI deployments for extraction and aCRF summary."
  },
  {
    id: "processing",
    route: "processing",
    title: "Process documents",
    shortTitle: "Processing",
    description: "Upload protocol and aCRF, then run extract, index, and aCRF summary end-to-end."
  },
  {
    id: "extract-rules",
    route: "extract-rules",
    title: "Extract rules",
    shortTitle: "Rules",
    description: "Extract protocol rules with paragraph references.",
    backendStepId: "extract-rules"
  },
  {
    id: "extract-deviations",
    route: "extract-deviations",
    title: "Extract deviations",
    shortTitle: "Deviations",
    description: "Extract, classify, and consolidate protocol deviation candidates.",
    backendStepId: "extract-deviations"
  },
  {
    id: "review",
    route: "review",
    title: "Review deviations",
    shortTitle: "Review",
    description: "Discuss and accept individual deviations with the assistant."
  },
  {
    id: "export",
    route: "export",
    title: "Export CSV",
    shortTitle: "Export",
    description: "Download accepted deviations as company PD Specifications CSV."
  },
  {
    id: "cost-analysis",
    route: "cost-analysis",
    title: "Cost analysis",
    shortTitle: "Cost",
    description: "Review estimated Azure OpenAI and Document Intelligence spend for this study."
  }
];

/** Legacy hash routes from the multi-step upload/extract wizard. */
export const LEGACY_PROCESSING_ROUTES = new Set([
  "upload",
  "extract-pdfs",
  "index-protocol",
  "acrf-split",
  "acrf-summary"
]);

export function pipelineStepByRoute(route: string): PipelineStepDef | undefined {
  return PIPELINE_STEPS.find((step) => step.route === route);
}

export function pipelineStepById(id: PipelineStepId): PipelineStepDef | undefined {
  return PIPELINE_STEPS.find((step) => step.id === id);
}

export function pipelineStepIndex(id: PipelineStepId): number {
  return PIPELINE_STEPS.findIndex((step) => step.id === id);
}
