import type { Step1PdfExtractor } from "../../services/stepApi";

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
  extractorChoice: Step1PdfExtractor;
  extractionLlmInstructions: string;
  onExtractorChange: (value: Step1PdfExtractor) => void;
  onLlmInstructionsChange: (value: string) => void;
  onRunFullPipeline: () => void;
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
  extractorChoice,
  extractionLlmInstructions,
  onExtractorChange,
  onLlmInstructionsChange,
  onRunFullPipeline,
  onMapPdSpecToReview,
  onEnrichPdSpecToReview,
  pipelineMessage,
  pipelineError
}: PipelineActionTilesProps): JSX.Element {
  return (
    <div className="pipeline-action-tiles" aria-label="Pipeline actions">
      <h3 className="study-pipeline-stage-title">Next steps</h3>
      <p className="step7-muted">
        Choose how to proceed after uploading source documents. Protocol and aCRF are prepared in the background after
        upload.
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
          </details>
          <button
            className="button button-primary"
            type="button"
            onClick={onRunFullPipeline}
            disabled={!bothUploaded || isBusy}
          >
            {isProcessing ? "Running pipeline…" : "Run pipeline to review"}
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

      {pipelineMessage ? <p className="step1-status">{pipelineMessage}</p> : null}
      {pipelineError ? <p className="step1-error">{pipelineError}</p> : null}
    </div>
  );
}
