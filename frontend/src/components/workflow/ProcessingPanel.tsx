import { useCallback, useEffect, useState } from "react";
import type { Step1PdfExtractor, StepStatus } from "../../services/stepApi";
import { fetchStep1Preview, uploadStep1Files } from "../../services/stepApi";
import { isProcessingDone } from "../../utils/processingStatus";
import { MarkdownPreview } from "./MarkdownPreview";

type ProcessingSubStepState = "pending" | "running" | "done" | "failed";

export interface ProcessingSubProgressItem {
  stepId: string;
  title: string;
  status: ProcessingSubStepState;
  message: string;
}

interface ProcessingPanelProps {
  studyId: string;
  backendStatuses: Record<string, StepStatus>;
  onStatusesChange: (statuses: Record<string, StepStatus>) => void;
  onRunProcessing: (extractor: Step1PdfExtractor) => Promise<void>;
  onRunToDmReview: () => Promise<void>;
  processingProgress: ProcessingSubProgressItem[];
  isProcessing: boolean;
  processingMessage: string;
  processingError: string;
  isAutoRunning: boolean;
  autoRunMessage: string;
  autoRunError: string;
}

const EXTRACTOR_LABELS: Record<Step1PdfExtractor, string> = {
  both: "Auto (recommended)",
  opendataloader: "OpenDataLoader",
  document_intelligence: "Document Intelligence (Azure)"
};

export function ProcessingPanel({
  studyId,
  backendStatuses,
  onStatusesChange,
  onRunProcessing,
  onRunToDmReview,
  processingProgress,
  isProcessing,
  processingMessage,
  processingError,
  isAutoRunning,
  autoRunMessage,
  autoRunError
}: ProcessingPanelProps): JSX.Element {
  const [protocolFile, setProtocolFile] = useState<File | null>(null);
  const [acrfFile, setAcrfFile] = useState<File | null>(null);
  const [extractorChoice, setExtractorChoice] = useState<Step1PdfExtractor>("both");
  const [isUploading, setIsUploading] = useState(false);
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [protocolPreview, setProtocolPreview] = useState("");
  const [acrfPreview, setAcrfPreview] = useState("");
  const [protocolFileName, setProtocolFileName] = useState("");
  const [acrfFileName, setAcrfFileName] = useState("");
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);

  const processingDone = isProcessingDone(backendStatuses);
  const canUpload = Boolean(studyId.trim() && protocolFile && acrfFile && !isUploading && !isProcessing);
  const canRunProcessing = Boolean(studyId.trim() && !isUploading && !isProcessing);
  const shouldShowProgress = isProcessing || processingDone || Boolean(processingMessage || processingError);
  const loadPreview = useCallback(async (): Promise<void> => {
    if (!studyId.trim()) {
      return;
    }
    setIsLoadingPreview(true);
    try {
      const preview = await fetchStep1Preview(studyId.trim());
      onStatusesChange(preview.stepStatuses);
      setProtocolPreview(preview.protocolPreview);
      setAcrfPreview(preview.acrfPreview);
      setProtocolFileName(preview.protocolFileName ?? "protocol.pdf");
      setAcrfFileName(preview.acrfFileName ?? "acrf.pdf");
    } catch {
      // Preview load is best-effort when revisiting a done study.
    } finally {
      setIsLoadingPreview(false);
    }
  }, [onStatusesChange, studyId]);

  useEffect(() => {
    setProtocolPreview("");
    setAcrfPreview("");
    setProtocolFileName("");
    setAcrfFileName("");
    setStatus("");
    setError("");
  }, [studyId]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview, processingDone]);

  async function handleUpload(): Promise<void> {
    if (!protocolFile || !acrfFile || !studyId.trim()) {
      return;
    }
    setError("");
    setStatus("");
    setIsUploading(true);
    try {
      const response = await uploadStep1Files(studyId.trim(), protocolFile, acrfFile);
      onStatusesChange(response.stepStatuses);
      setProtocolFileName(response.protocolFileName ?? protocolFile.name);
      setAcrfFileName(response.acrfFileName ?? acrfFile.name);
      setStatus(`Uploaded ${response.protocolFileName ?? protocolFile.name} and ${response.acrfFileName ?? acrfFile.name}`);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleRunProcessing(): Promise<void> {
    if (!studyId.trim()) {
      return;
    }
    setError("");
    setStatus("");
    try {
      await onRunProcessing(extractorChoice);
      setStatus("Processing completed. Preview loaded.");
      await loadPreview();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Processing failed.");
    }
  }

  const runButtonLabel = processingDone
    ? isProcessing
      ? "Re-running…"
      : "Re-run processing"
    : isProcessing
      ? "Running processing…"
      : "Run processing";

  return (
    <section className="workflow-panel step1-panel" aria-label="Processing">
      <fieldset className="step1-extractor-fieldset">
        <legend className="control-label">PDF extractor</legend>
        <div className="step1-extractor-options">
          {(["both", "document_intelligence", "opendataloader"] as const).map((value) => (
            <label className="step1-radio-label" key={value}>
              <input
                type="radio"
                name="pdf-extractor"
                value={value}
                checked={extractorChoice === value}
                onChange={() => setExtractorChoice(value)}
                disabled={isProcessing}
              />
              <span>{EXTRACTOR_LABELS[value]}</span>
            </label>
          ))}
        </div>
        {extractorChoice === "opendataloader" ? (
          <p className="step1-warning">OpenDataLoader-only may fail during TOC split without TOC rows.</p>
        ) : null}
      </fieldset>

      <div className="step1-inputs">
        <label className="control-group" htmlFor="protocol-file">
          <span className="control-label">Protocol PDF</span>
          <input
            id="protocol-file"
            className="input"
            type="file"
            accept=".pdf,application/pdf"
            disabled={isProcessing}
            onChange={(event) => {
              setProtocolFile(event.target.files?.[0] ?? null);
            }}
          />
        </label>
        <label className="control-group" htmlFor="acrf-file">
          <span className="control-label">aCRF PDF</span>
          <input
            id="acrf-file"
            className="input"
            type="file"
            accept=".pdf,application/pdf"
            disabled={isProcessing}
            onChange={(event) => {
              setAcrfFile(event.target.files?.[0] ?? null);
            }}
          />
        </label>
      </div>

      <div className="step1-actions">
        <button className="button button-secondary" type="button" onClick={() => void handleUpload()} disabled={!canUpload}>
          {isUploading ? "Uploading…" : "Upload"}
        </button>
        <button
          className="button button-primary"
          type="button"
          onClick={() => void handleRunProcessing()}
          disabled={!canRunProcessing}
        >
          {runButtonLabel}
        </button>
        <button
          className="button button-optional"
          type="button"
          onClick={() => void onRunToDmReview()}
          disabled={!processingDone || isUploading || isProcessing || isAutoRunning}
        >
          {isAutoRunning ? "Running pipeline…" : "Run to review"}
        </button>
      </div>

      <p className="step1-note">Upload PDFs for a new study, or run processing on an existing blob study.</p>
      {isProcessing ? (
        <div className="step1-extraction-progress" role="status" aria-live="polite">
          <span className="step1-extraction-circle" aria-hidden="true" />
          <span>Processing…</span>
        </div>
      ) : null}
      {status ? <p className="step1-status">{status}</p> : null}
      {error ? <p className="step1-error">{error}</p> : null}
      {processingMessage ? <p className="step1-status">{processingMessage}</p> : null}
      {processingError ? <p className="step1-error">{processingError}</p> : null}
      {autoRunMessage ? <p className="step1-status">{autoRunMessage}</p> : null}
      {autoRunError ? <p className="step1-error">{autoRunError}</p> : null}

      {shouldShowProgress ? (
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
      ) : null}

      {isLoadingPreview ? <p className="step1-status">Loading preview…</p> : null}

      {protocolPreview || acrfPreview || processingDone ? (
        <div className="step1-preview-grid">
          <article className="preview-item">
            <p className="preview-title">
              Protocol{protocolFileName ? ` — ${protocolFileName}` : ""}
            </p>
            <MarkdownPreview content={protocolPreview} />
          </article>
          <article className="preview-item">
            <p className="preview-title">aCRF{acrfFileName ? ` — ${acrfFileName}` : ""}</p>
            <MarkdownPreview content={acrfPreview} />
          </article>
        </div>
      ) : null}
    </section>
  );
}
