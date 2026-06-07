import { PROCESSING_BACKEND_STEP_IDS } from "../../data/pipelineSteps";
import type { StepStatus } from "../../services/stepApi";
import {
  getPipelineActionAccess,
  getPipelinePrimaryLabel,
  type PipelineActionAccess
} from "../../utils/pipelineActionAccess";
import { isProcessingCoreDone, isProcessingDone } from "../../utils/processingStatus";

export interface PipelineActionTilesProps {
  bothUploaded: boolean;
  pdSpecUploaded: boolean;
  uploadStatusReady: boolean;
  isBusy: boolean;
  isProcessing: boolean;
  backendStatuses: Record<string, StepStatus>;
  onRunFullPipeline: () => void;
  onReRunPipeline: () => void;
  onMapPdSpecToReview: () => void;
  onEnrichPdSpecToReview: () => void;
  pipelineMessage?: string;
  pipelineError?: string;
  hideStatusMessages?: boolean;
}

function tileClassName(access: PipelineActionAccess): string {
  return `pipeline-action-tile ${access.accessible ? "pipeline-action-tile-active" : "pipeline-action-tile-disabled"}`;
}

function ActionRow({
  access,
  primaryLabel,
  onPrimary,
  onRerun,
  rerunAriaLabel
}: {
  access: PipelineActionAccess;
  primaryLabel: string;
  onPrimary: () => void;
  onRerun: () => void;
  rerunAriaLabel: string;
}): JSX.Element {
  return (
    <div className="pipeline-action-tile-actions">
      <button className="button button-primary" type="button" onClick={onPrimary} disabled={!access.accessible}>
        {primaryLabel}
      </button>
      <button
        className="button button-secondary button-compact-rerun"
        type="button"
        onClick={onRerun}
        disabled={!access.accessible || !access.canRerun}
        title={rerunAriaLabel}
      >
        Re-run
      </button>
    </div>
  );
}

export function PipelineActionTiles({
  bothUploaded,
  pdSpecUploaded,
  uploadStatusReady,
  isBusy,
  isProcessing,
  backendStatuses,
  onRunFullPipeline,
  onReRunPipeline,
  onMapPdSpecToReview,
  onEnrichPdSpecToReview,
  pipelineMessage,
  pipelineError,
  hideStatusMessages = false
}: PipelineActionTilesProps): JSX.Element {
  const processingDone = isProcessingDone(backendStatuses);
  const processingCoreDone = isProcessingCoreDone(backendStatuses);
  const hasPartialProgress =
    bothUploaded &&
    !processingDone &&
    PROCESSING_BACKEND_STEP_IDS.some((stepId) => {
      const status = backendStatuses[stepId];
      return status === "done" || status === "skipped";
    });

  const accessInput = {
    bothUploaded,
    pdSpecUploaded,
    backendStatuses,
    isBusy,
    isProcessing
  };
  const access = getPipelineActionAccess(accessInput);
  const pipelinePrimaryLabel = getPipelinePrimaryLabel(accessInput);

  const introText = processingDone
    ? "All processing steps are complete. Choose how to open Review — extract from protocol, map PD Specifications, or enrich with protocol and aCRF analysis."
    : hasPartialProgress
      ? "Some steps are already complete from blob storage. Continue the pipeline, map PD Specifications, or enrich when prerequisites are met."
      : "Choose how to proceed after uploading source documents. Protocol and aCRF are prepared in the background after upload.";

  return (
    <div className="pipeline-action-tiles" aria-label="Pipeline actions">
      <h3 className="study-pipeline-stage-title">Next steps</h3>

      {uploadStatusReady ? (
        <>
          <p className="step7-muted">{introText}</p>

          {processingDone ? (
            <div className="pipeline-processing-complete" role="status">
              <div className="pipeline-processing-complete-indicator">
                <span className="pipeline-processing-complete-circle" aria-hidden="true">
                  ✓
                </span>
                <span className="pipeline-processing-complete-label">Processing complete — ready for review</span>
              </div>
            </div>
          ) : null}

          <div className="pipeline-action-tiles-grid">
            <article className={tileClassName(access.pipeline)}>
              <h4 className="pipeline-action-tile-title">Extract deviations from protocol</h4>
              <p className="step7-muted">
                Run the full pipeline: PDF extraction, protocol index, aCRF summary, rule extraction, and deviation
                candidates — then open Review.
              </p>
              {!access.pipeline.accessible && access.pipeline.blockReason ? (
                <p className="pipeline-action-tile-hint">{access.pipeline.blockReason}</p>
              ) : null}
              {processingCoreDone || hasPartialProgress ? (
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={onReRunPipeline}
                  disabled={!access.pipeline.accessible}
                >
                  Re-run all steps (overwrite)
                </button>
              ) : null}
              <ActionRow
                access={access.pipeline}
                primaryLabel={pipelinePrimaryLabel}
                onPrimary={onRunFullPipeline}
                onRerun={onReRunPipeline}
                rerunAriaLabel="Re-run full pipeline to review"
              />
            </article>

            <article className={tileClassName(access.map)}>
              <h4 className="pipeline-action-tile-title">Use imported PD Specifications</h4>
              <p className="step7-muted">
                Map the uploaded PD Specifications workbook to the Review page (imported lane). Rows can be accepted,
                discussed with the assistant, and used for coding.
              </p>
              {!access.map.accessible && access.map.blockReason ? (
                <p className="pipeline-action-tile-hint">{access.map.blockReason}</p>
              ) : null}
              <ActionRow
                access={access.map}
                primaryLabel="Map to review"
                onPrimary={onMapPdSpecToReview}
                onRerun={onMapPdSpecToReview}
                rerunAriaLabel="Re-run map to review"
              />
            </article>

            <article className={tileClassName(access.enrich)}>
              <h4 className="pipeline-action-tile-title">Enrich PD Specifications</h4>
              <p className="step7-muted">
                Run parallel protocol and aCRF analysis to refine deviation logic, surface caveats and assumptions, and
                flag weak spots — then open Review on the enriched lane.
              </p>
              {!access.enrich.accessible && access.enrich.blockReason ? (
                <p className="pipeline-action-tile-hint">{access.enrich.blockReason}</p>
              ) : null}
              <ActionRow
                access={access.enrich}
                primaryLabel="Enrich and open review"
                onPrimary={onEnrichPdSpecToReview}
                onRerun={onEnrichPdSpecToReview}
                rerunAriaLabel="Re-run enrich and open review"
              />
            </article>
          </div>
        </>
      ) : (
        <p className="step7-muted">Select or create a study and wait for upload status before choosing a next step.</p>
      )}

      {hideStatusMessages ? null : pipelineMessage ? <p className="step1-status">{pipelineMessage}</p> : null}
      {hideStatusMessages ? null : pipelineError ? <p className="step1-error">{pipelineError}</p> : null}
    </div>
  );
}
