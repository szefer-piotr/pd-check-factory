import type { StudyWorkflow } from "../services/stepApi";

export const WORKFLOW_TILES: Array<{
  id: StudyWorkflow;
  title: string;
  description: string;
}> = [
  {
    id: "extract",
    title: "Extract PD from protocol + aCRF",
    description: "Run the full extraction pipeline from protocol and annotated CRF source documents."
  },
  {
    id: "enrich",
    title: "Enrich PD Specifications",
    description: "Import a PD Spec workbook and enrich each deviation with protocol grounding."
  },
  {
    id: "map",
    title: "Map uploaded PD Specifications to Review",
    description: "Import a PD Spec workbook and map rows directly into the review workspace."
  }
];

export function workflowLabel(workflow: StudyWorkflow | null | undefined): string {
  if (!workflow) {
    return "Not selected";
  }
  return WORKFLOW_TILES.find((tile) => tile.id === workflow)?.title ?? workflow;
}

export function stagePath(studyId: string, stage: string): string {
  if (stage === "project") {
    return `/projects/${encodeURIComponent(studyId)}`;
  }
  return `/projects/${encodeURIComponent(studyId)}/${stage}`;
}
