import type { PipelineStepId, StudySetupSection } from "./pipelineSteps";
import type { StepArtifactVersionEntry, StepStatus } from "../services/stepApi";

export type InspectorTab = "protocol" | "acrf" | "versions" | "activity";

export interface ProtocolFocus {
  focusRef?: string;
  highlightRefs: string[];
}

export interface ArtifactVersionsSnapshot {
  stepId: string;
  versions: StepArtifactVersionEntry[];
  activeVersion: string | null;
  stepStatuses: Record<string, StepStatus>;
  disabled?: boolean;
  onSelect: (version: string) => void;
}

export interface PipelineNavSnapshot {
  stepId: PipelineStepId;
  section: StudySetupSection;
  studySelected: boolean;
  configSaved: boolean;
  processingComplete: boolean;
  rulesDone: boolean;
  deviationsDone: boolean;
  canNavigateTo: (stepId: PipelineStepId) => boolean;
  navigate: (stepId: PipelineStepId, options?: { section?: StudySetupSection }) => void;
}

export const EMPTY_PROTOCOL_FOCUS: ProtocolFocus = {
  focusRef: undefined,
  highlightRefs: []
};

export function defaultNavSnapshot(): PipelineNavSnapshot {
  return {
    stepId: "study-setup",
    section: "study",
    studySelected: false,
    configSaved: false,
    processingComplete: false,
    rulesDone: false,
    deviationsDone: false,
    canNavigateTo: () => true,
    navigate: () => undefined
  };
}
