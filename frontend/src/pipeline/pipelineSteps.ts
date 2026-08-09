/** Top-level pipeline IA: Study setup → Rules → Deviations → Cost. */

export type PipelineStepId = "study-setup" | "rules" | "deviations" | "cost-analysis";

export type StudySetupSection = "study" | "config" | "processing";

export type BackendExtractStepId = "extract-rules" | "extract-deviations";

export interface PipelineStepDef {
  id: PipelineStepId;
  route: string;
  title: string;
  shortTitle: string;
  description: string;
  /** Backend extract step that marks this UI step complete (when set). */
  backendStepId?: BackendExtractStepId;
}

export const PIPELINE_STEPS: PipelineStepDef[] = [
  {
    id: "study-setup",
    route: "study-setup",
    title: "Study setup",
    shortTitle: "Study setup",
    description: "Select a study, configure models, upload documents, and run extractions."
  },
  {
    id: "rules",
    route: "rules",
    title: "Rules",
    shortTitle: "Rules",
    description: "Extract protocol rules, preview them, and discuss edits in chat.",
    backendStepId: "extract-rules"
  },
  {
    id: "deviations",
    route: "deviations",
    title: "Deviations",
    shortTitle: "Deviations",
    description: "Extract deviations, refine them with chat, and export the accepted set.",
    backendStepId: "extract-deviations"
  },
  {
    id: "cost-analysis",
    route: "cost-analysis",
    title: "Cost analysis",
    shortTitle: "Cost",
    description: "Review estimated Azure OpenAI and Document Intelligence spend for this study."
  }
];

/** Legacy and collapsed routes that redirect into the new IA. */
export const LEGACY_ROUTE_REDIRECTS: Record<
  string,
  { stepId: PipelineStepId; section?: StudySetupSection }
> = {
  study: { stepId: "study-setup", section: "study" },
  config: { stepId: "study-setup", section: "config" },
  processing: { stepId: "study-setup", section: "processing" },
  upload: { stepId: "study-setup", section: "processing" },
  "extract-pdfs": { stepId: "study-setup", section: "processing" },
  "index-protocol": { stepId: "study-setup", section: "processing" },
  "acrf-split": { stepId: "study-setup", section: "processing" },
  "acrf-summary": { stepId: "study-setup", section: "processing" },
  "extract-rules": { stepId: "rules" },
  "extract-deviations": { stepId: "deviations" },
  review: { stepId: "deviations" },
  export: { stepId: "deviations" }
};

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
