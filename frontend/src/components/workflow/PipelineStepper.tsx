export type PipelineStageId = "upload" | "extract" | "deviations" | "review";

export type PipelineStageStatus = "locked" | "ready" | "in_progress" | "done" | "failed";

export interface PipelineStage {
  id: PipelineStageId;
  title: string;
  description: string;
  status: PipelineStageStatus;
}

interface PipelineStepperProps {
  stages: PipelineStage[];
  onSelect?: (stageId: PipelineStageId) => void;
}

export function PipelineStepper({ stages, onSelect }: PipelineStepperProps): JSX.Element {
  return (
    <ol className="pipeline-stepper" aria-label="Study pipeline stages">
      {stages.map((stage, index) => (
        <li
          key={stage.id}
          className={`pipeline-step pipeline-step-${stage.status} ${onSelect ? "pipeline-step-clickable" : ""}`}
        >
          <button
            type="button"
            className="pipeline-step-button"
            disabled={!onSelect || stage.status === "locked"}
            onClick={() => onSelect?.(stage.id)}
          >
            <span className="pipeline-step-index" aria-hidden="true">
              {index + 1}
            </span>
            <span className="pipeline-step-text">
              <span className="pipeline-step-title">{stage.title}</span>
              <span className="pipeline-step-desc">{stage.description}</span>
            </span>
            <span className={`pipeline-step-badge pipeline-step-badge-${stage.status}`}>{stage.status}</span>
          </button>
        </li>
      ))}
    </ol>
  );
}
