import type { ExtractionRunState } from "../../hooks/useStudyPipelineState";
import type { ProcessingSubProgressItem } from "./ProcessingPanel";

interface ExtractionStatusPanelProps {
  extraction: ExtractionRunState;
  processingProgress: ProcessingSubProgressItem[];
  isProcessing: boolean;
  processingMessage: string;
  processingError: string;
}

const STAGE_LABELS: Record<string, string> = {
  upload: "Preparing documents",
  extract: "Extracting PDFs (Document Intelligence / OCR)",
  index: "Indexing protocol",
  acrf_split: "Splitting aCRF TOC",
  acrf_merge: "Merging aCRF summary",
  rules: "Extracting rules",
  deviations: "Generating deviations",
  finalize: "Finalizing",
  complete: "Complete"
};

const SUB_STEP_LABELS: Record<string, string> = {
  "extract-inputs": "Extract PDFs to markdown",
  "index-protocol": "Build paragraph index",
  "acrf-split-toc": "Split aCRF sections",
  "acrf-summary-text": "Merge aCRF summary text",
  "extract-rules": "Extract protocol rules",
  "extract-deviations": "Extract deviation candidates"
};

export function ExtractionStatusPanel({
  extraction,
  processingProgress,
  isProcessing,
  processingMessage,
  processingError
}: ExtractionStatusPanelProps): JSX.Element | null {
  const showPanel =
    isProcessing ||
    extraction.status !== "idle" ||
    processingProgress.some((item) => item.status !== "pending") ||
    Boolean(processingMessage || processingError);

  if (!showPanel) {
    return null;
  }

  const stageLabel =
    STAGE_LABELS[extraction.currentStage] ||
    STAGE_LABELS[processingMessage ? "extract" : ""] ||
    (isProcessing ? "Running extraction pipeline" : "");
  const subStepLabel = SUB_STEP_LABELS[extraction.currentSubStepId] ?? extraction.currentSubStepId;

  const allLogs = [
    ...extraction.logs,
    ...processingProgress
      .filter((item) => item.message && item.message !== "Waiting")
      .map((item) => ({
        ts: "",
        level: item.status === "failed" ? ("error" as const) : ("info" as const),
        text: `${item.title}: ${item.message}`
      }))
  ];

  return (
    <section className="extraction-status-panel" aria-label="Extraction status">
      {isProcessing || extraction.status === "running" ? (
        <div className="extraction-wait-banner" role="status">
          <span className="step1-extraction-circle" aria-hidden="true" />
          <div>
            <strong>Please wait — processing is in progress</strong>
            <p className="step7-muted">This step can take several minutes, especially Document Intelligence extraction.</p>
          </div>
        </div>
      ) : null}

      {stageLabel ? (
        <p className="extraction-stage-line">
          <span className="extraction-stage-label">Current stage:</span> {stageLabel}
        </p>
      ) : null}
      {subStepLabel && (isProcessing || extraction.status === "running") ? (
        <p className="extraction-substep-line">
          <span className="extraction-stage-label">Sub-step:</span> {subStepLabel}
        </p>
      ) : null}

      {processingMessage || extraction.message ? (
        <p className="step1-status">{processingMessage || extraction.message}</p>
      ) : null}
      {processingError || extraction.error ? (
        <p className="step1-error">{processingError || extraction.error}</p>
      ) : null}

      {extraction.status === "failed" && !isProcessing ? (
        <p className="step1-error">Extraction failed. Review the log below and try again.</p>
      ) : null}

      {extraction.status === "done" && !isProcessing ? (
        <p className="step1-status">Extraction completed. You can continue to the next stage.</p>
      ) : null}

      <div className="auto-run-progress" aria-live="polite">
        {processingProgress.map((item) => (
          <div className="auto-run-step" key={item.stepId}>
            <span className={`auto-run-circle auto-run-circle-${item.status}`} aria-hidden="true">
              {item.status === "failed" ? "!" : ""}
            </span>
            <div>
              <span className="auto-run-title">{item.title}</span>
              <span className="auto-run-message">{item.message}</span>
            </div>
          </div>
        ))}
      </div>

      {allLogs.length > 0 ? (
        <details className="extraction-log-details" open={isProcessing}>
          <summary>Processing log ({allLogs.length} lines)</summary>
          <pre className="extraction-log-pre">
            {allLogs
              .slice(-80)
              .map((line) => (line.ts ? `[${line.ts}] ${line.text}` : line.text))
              .join("\n")}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
