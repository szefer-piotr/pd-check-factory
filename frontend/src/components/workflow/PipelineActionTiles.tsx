import { PROCESSING_BACKEND_STEP_IDS } from "../../data/pipelineSteps";
import type { Step1PdfExtractor, StepStatus } from "../../services/stepApi";
import { isProcessingCoreDone, isProcessingDone } from "../../utils/processingStatus";

const EXTRACTOR_LABELS: Record<Step1PdfExtractor, string> = {
  both: "Auto (recommended)",
  opendataloader: "OpenDataLoader",
  document_intelligence: "Document Intelligence (Azure)"
};

export interface PipelineActionTilesProps {
  bothUploaded: boolean;
  allThreeUploaded: boolean;
  isBusy: boolean;
  isProcessing: boolean;
  backendStatuses: Record<string, StepStatus>;
  extractorChoice: Step1PdfExtractor;
  extractionLlmInstructions: string;
  onExtractorChange: (value: Step1PdfExtractor) => void;
  onLlmInstructionsChange: (value: string) => void;
  onRunFullPipeline: () => void;
  onReRunPipeline: () => void;
  onMapPdSpecToReview: () => void;
  onEnrichPdSpecToReview: () => void;
  pipelineMessage?: string;
  pipelineError?: string;
}

export function PipelineActionTiles({
  bothUploaded,
  allThreeUploaded,
  isBusy,
  isProcessing,
  backendStatuses,
  extractorChoice,
  extractionLlmInstructions,
  onExtractorChange,
  onLlmInstructionsChange,
  onRunFullPipeline,
  onReRunPipeline,
  onMapPdSpecToReview,
  onEnrichPdSpecToReview,
  pipelineMessage,
  pipelineError
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

  const runLabel = processingDone
    ? isProcessing
      ? "Re-running…"
      : "Re-run"
    : hasPartialProgress
      ? isProcessing
        ? "Continuing…"
        : "Continue pipeline to review"
      : isProcessing
        ? "Running pipeline…"
        : "Run pipeline to review";

  return (
    <div className="pipeline-action-tiles" aria-label="Pipeline actions">
      <h3 className="study-pipeline-stage-title">Next steps</h3>

      {processingDone ? (
        <>
          <p className="step7-muted">
            All processing steps are complete. Documents were restored from blob storage or finished in a prior run.
          </p>
          <div className="pipeline-processing-complete">
            <div className="pipeline-processing-complete-indicator" role="status">
              <span className="pipeline-processing-complete-circle" aria-hidden="true">
                ✓
              </span>
              <span className="pipeline-processing-complete-label">Processing complete — ready for review</span>
            </div>
            <button
              className="button button-secondary button-compact-rerun"
              type="button"
              onClick={onReRunPipeline}
              disabled={!bothUploaded || isBusy}
              title="Re-run all processing steps and overwrite existing outputs"
            >
              {runLabel}
            </button>
          </div>
          {allThreeUploaded ? (
            <div className="pipeline-action-tiles-grid">
              <article className="pipeline-action-tile pipeline-action-tile-active">
                <h4 className="pipeline-action-tile-title">Use imported PD Specifications</h4>
                <p className="step7-muted">
                  Map the uploaded PD Specifications workbook to the Review page.
                </p>
                <button
                  className="button button-primary"
                  type="button"
                  onClick={onMapPdSpecToReview}
                  disabled={isBusy}
                >
                  Map to review
                </button>
              </article>
              <article className="pipeline-action-tile pipeline-action-tile-active">
                <h4 className="pipeline-action-tile-title">Enrich PD Specifications</h4>
                <p className="step7-muted">Preview: same as mapping for now.</p>
                <button
                  className="button button-secondary"
                  type="button"
                  onClick={onEnrichPdSpecToReview}
                  disabled={isBusy}
                >
                  Enrich and open review
                </button>
              </article>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <p className="step7-muted">
            {hasPartialProgress
              ? "Some steps are already complete from blob storage. Continue to run remaining steps, or use advanced options to re-run everything."
              : "Choose how to proceed after uploading source documents. Protocol and aCRF are prepared in the background after upload."}
          </p>

          <div className="pipeline-action-tiles-grid">
            <article
              className={`pipeline-action-tile ${bothUploaded ? "pipeline-action-tile-active" : "pipeline-action-tile-disabled"}`}
            >
              <h4 className="pipeline-action-tile-title">Extract deviations from protocol</h4>
              <p className="step7-muted">
                Run the full pipeline: PDF extraction, protocol index, aCRF summary, rule extraction, and deviation
                candidates — then open Review.
              </p>
              <details className="pipeline-action-tile-advanced">
                <summary>Advanced options</summary>
                <fieldset className="step1-extractor-fieldset" disabled={!bothUploaded || isBusy}>
                  <legend className="control-label">PDF extractor</legend>
                  <div className="step1-extractor-options">
                    {(["both", "document_intelligence", "opendataloader"] as const).map((value) => (
                      <label className="step1-radio-label" key={value}>
                        <input
                          type="radio"
                          name="pdf-extractor-tile"
                          value={value}
                          checked={extractorChoice === value}
                          onChange={() => onExtractorChange(value)}
                          disabled={isBusy}
                        />
                        <span>{EXTRACTOR_LABELS[value]}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label className="control-group" htmlFor="extraction-llm-instructions-tile">
                  <span className="control-label">Optional LLM instructions</span>
                  <textarea
                    id="extraction-llm-instructions-tile"
                    className="input"
                    rows={2}
                    value={extractionLlmInstructions}
                    onChange={(event) => onLlmInstructionsChange(event.target.value)}
                    disabled={isBusy}
                    placeholder="Additional guidance for rule and deviation extraction"
                  />
                </label>
                {processingCoreDone || hasPartialProgress ? (
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={onReRunPipeline}
                    disabled={!bothUploaded || isBusy}
                  >
                    Re-run all steps (overwrite)
                  </button>
                ) : null}
              </details>
              <button
                className="button button-primary"
                type="button"
                onClick={onRunFullPipeline}
                disabled={!bothUploaded || isBusy}
              >
                {runLabel}
              </button>
            </article>

            {allThreeUploaded ? (
              <>
                <article className="pipeline-action-tile pipeline-action-tile-active">
                  <h4 className="pipeline-action-tile-title">Use imported PD Specifications</h4>
                  <p className="step7-muted">
                    Map the uploaded PD Specifications workbook to the Review page. Rows can be accepted, discussed with
                    the assistant, and used for coding.
                  </p>
                  <button
                    className="button button-primary"
                    type="button"
                    onClick={onMapPdSpecToReview}
                    disabled={isBusy}
                  >
                    Map to review
                  </button>
                </article>

                <article className="pipeline-action-tile pipeline-action-tile-active">
                  <h4 className="pipeline-action-tile-title">Enrich PD Specifications</h4>
                  <p className="step7-muted">
                    Preview: same as mapping for now. Future releases will revise imported deviations using protocol and
                    aCRF context.
                  </p>
                  <button
                    className="button button-secondary"
                    type="button"
                    onClick={onEnrichPdSpecToReview}
                    disabled={isBusy}
                  >
                    Enrich and open review
                  </button>
                </article>
              </>
            ) : null}
          </div>
        </>
      )}

      {pipelineMessage ? <p className="step1-status">{pipelineMessage}</p> : null}
      {pipelineError ? <p className="step1-error">{pipelineError}</p> : null}
    </div>
  );
}
