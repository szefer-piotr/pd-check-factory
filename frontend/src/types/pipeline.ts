export interface PipelineArtifact {
  label: string;
  path: string;
  description: string;
}

export interface PipelinePreviewItem {
  title: string;
  body: string;
  highlight?: boolean;
}

export interface PipelineStepDefinition {
  id: string;
  title: string;
  summary: string;
  instructions: string[];
  inputSources: PipelineArtifact[];
  outputArtifacts: PipelineArtifact[];
  previewItems: PipelinePreviewItem[];
}

export type Step7ReviewStatus = "pending" | "to_review" | "accepted" | "rejected";
