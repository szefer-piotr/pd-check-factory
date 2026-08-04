/** Top-level pipeline IA: Study setup → Generate PD → Review → Cost. */

export type PipelineStepId = "study-setup" | "generate-pd" | "review" | "cost-analysis";

export type GeneratePdSubStep = "rules" | "deviations";

export type StudySetupSection = "study" | "config" | "processing";

export interface PipelineStepDef {
  id: PipelineStepId;
  route: string;
  title: string;
  shortTitle: string;
  description: string;
}

export interface GeneratePdChildDef {
  id: GeneratePdSubStep;
  route: string;
  title: string;
  shortTitle: string;
  description: string;
  backendStepId: "extract-rules" | "extract-deviations";
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
    id: "generate-pd",
    route: "generate-pd",
    title: "Generate protocol deviations",
    shortTitle: "Generate PD",
    description: "Extract rules and deviations. Run each substep manually."
  },
  {
    id: "review",
    route: "review",
    title: "Review deviations",
    shortTitle: "Review",
    description: "Discuss, accept, and export the current review state."
  },
  {
    id: "cost-analysis",
    route: "cost-analysis",
    title: "Cost analysis",
    shortTitle: "Cost",
    description: "Review estimated Azure OpenAI and Document Intelligence spend for this study."
  }
];

export const GENERATE_PD_CHILDREN: GeneratePdChildDef[] = [
  {
    id: "rules",
    route: "rules",
    title: "Extract rules",
    shortTitle: "Rules",
    description: "Extract protocol rules with paragraph references.",
    backendStepId: "extract-rules"
  },
  {
    id: "deviations",
    route: "deviations",
    title: "Extract deviations",
    shortTitle: "Deviations",
    description: "Extract, classify, and consolidate protocol deviation candidates.",
    backendStepId: "extract-deviations"
  }
];

/** Legacy and collapsed routes that redirect into the new IA. */
export const LEGACY_ROUTE_REDIRECTS: Record<string, { stepId: PipelineStepId; subStep?: GeneratePdSubStep; section?: StudySetupSection }> = {
  study: { stepId: "study-setup", section: "study" },
  config: { stepId: "study-setup", section: "config" },
  processing: { stepId: "study-setup", section: "processing" },
  upload: { stepId: "study-setup", section: "processing" },
  "extract-pdfs": { stepId: "study-setup", section: "processing" },
  "index-protocol": { stepId: "study-setup", section: "processing" },
  "acrf-split": { stepId: "study-setup", section: "processing" },
  "acrf-summary": { stepId: "study-setup", section: "processing" },
  "extract-rules": { stepId: "generate-pd", subStep: "rules" },
  "extract-deviations": { stepId: "generate-pd", subStep: "deviations" },
  export: { stepId: "review" }
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

export function generatePdChildById(id: GeneratePdSubStep): GeneratePdChildDef | undefined {
  return GENERATE_PD_CHILDREN.find((child) => child.id === id);
}

export function backendStepDefForSubStep(subStep: GeneratePdSubStep): GeneratePdChildDef {
  return generatePdChildById(subStep) ?? GENERATE_PD_CHILDREN[0];
}
