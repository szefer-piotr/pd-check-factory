/** Linear extract-only pipeline steps (one UI page each). */

export type PipelineStepId =
  | "study"
  | "config"
  | "upload"
  | "extract-pdfs"
  | "index-protocol"
  | "acrf-split"
  | "acrf-summary"
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
    id: "upload",
    route: "upload",
    title: "Upload documents",
    shortTitle: "Upload",
    description: "Upload protocol and annotated CRF PDFs."
  },
  {
    id: "extract-pdfs",
    route: "extract-pdfs",
    title: "Extract PDF text",
    shortTitle: "Extract PDFs",
    description: "Run Azure Document Intelligence layout analysis on both PDFs.",
    backendStepId: "extract-inputs"
  },
  {
    id: "index-protocol",
    route: "index-protocol",
    title: "Index protocol",
    shortTitle: "Index",
    description: "Build paragraph-level index (p1, p2, …) from protocol markdown.",
    backendStepId: "index-protocol"
  },
  {
    id: "acrf-split",
    route: "acrf-split",
    title: "Split aCRF sections",
    shortTitle: "aCRF split",
    description: "Split aCRF markdown into TOC section files.",
    backendStepId: "acrf-split-toc"
  },
  {
    id: "acrf-summary",
    route: "acrf-summary",
    title: "aCRF summary",
    shortTitle: "aCRF summary",
    description: "Merge dataset and column hints from aCRF sections.",
    backendStepId: "acrf-summary-text"
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

export function pipelineStepByRoute(route: string): PipelineStepDef | undefined {
  return PIPELINE_STEPS.find((step) => step.route === route);
}

export function pipelineStepById(id: PipelineStepId): PipelineStepDef | undefined {
  return PIPELINE_STEPS.find((step) => step.id === id);
}

export function pipelineStepIndex(id: PipelineStepId): number {
  return PIPELINE_STEPS.findIndex((step) => step.id === id);
}
