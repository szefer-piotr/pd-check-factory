import { Link, useLocation } from "react-router-dom";
import { stagePath } from "../../types/workflow";
import { isWorkflowExtractionComplete } from "../../utils/processingSteps";
import type { StudyWorkflow, UiStage } from "../../services/stepApi";

interface WorkflowStageNavProps {
  studyId: string;
  workflow: StudyWorkflow | null | undefined;
  uiStage: UiStage | undefined;
  stepStatuses: Record<string, string>;
}

const STAGES: Array<{ id: UiStage; label: string }> = [
  { id: "setup", label: "Setup" },
  { id: "summary", label: "Summary" },
  { id: "review", label: "Review" }
];

export function WorkflowStageNav({
  studyId,
  workflow,
  uiStage,
  stepStatuses
}: WorkflowStageNavProps): JSX.Element | null {
  const location = useLocation();
  const trimmed = studyId.trim();
  if (!trimmed || !workflow) {
    return null;
  }

  const reviewReady = isWorkflowExtractionComplete(workflow, stepStatuses);

  return (
    <nav className="workflow-phase-nav" aria-label="Workflow stages">
      {STAGES.map((stage) => {
        const path = stagePath(trimmed, stage.id);
        const isActive = location.pathname === path || uiStage === stage.id;
        const disabled = stage.id === "review" && !reviewReady;
        if (disabled) {
          return (
            <span
              key={stage.id}
              className={`workflow-phase-nav-item workflow-phase-nav-item-disabled${isActive ? " workflow-phase-nav-item-active" : ""}`}
              aria-disabled="true"
            >
              {stage.label}
            </span>
          );
        }
        return (
          <Link
            key={stage.id}
            className={`workflow-phase-nav-item${isActive ? " workflow-phase-nav-item-active" : ""}`}
            to={path}
          >
            {stage.label}
          </Link>
        );
      })}
    </nav>
  );
}
