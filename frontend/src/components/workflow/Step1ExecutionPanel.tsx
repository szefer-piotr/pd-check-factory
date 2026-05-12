import { useEffect, useState } from "react";
import type { Step1PdfExtractor, StepStatus } from "../../services/stepApi";
import { fetchStep1Preview, runStep1Extraction, uploadStep1Files } from "../../services/stepApi";

type AutoRunStepState = "pending" | "running" | "done" | "failed";

interface AutoRunProgressItem {
  stepId: string;
  title: string;
  status: AutoRunStepState;
  message: string;
}

interface Step1ExecutionPanelProps {
  studyId: string;
  onMoveNext: () => void;
  onStatusesChange: (statuses: Record<string, StepStatus>) => void;
  onRunToDmReview: () => Promise<void>;
  autoRunProgress: AutoRunProgressItem[];
  isAutoRunning: boolean;
  autoRunMessage: string;
  autoRunError: string;
}

const EXTRACTOR_LABELS: Record<Step1PdfExtractor, string> = {
  both: "Auto (recommended)",
  opendataloader: "OpenDataLoader",
  document_intelligence: "Document Intelligence (Azure)"
};

export function Step1ExecutionPanel({
  studyId,
  onMoveNext,
  onStatusesChange,
  onRunToDmReview,
  autoRunProgress,
  isAutoRunning,
  autoRunMessage,
  autoRunError
}: Step1ExecutionPanelProps): JSX.Element {
  const [protocolFile, setProtocolFile] = useState<File | null>(null);
  const [acrfFile, setAcrfFile] = useState<File | null>(null);
  const [extractorChoice, setExtractorChoice] = useState<Step1PdfExtractor>("both");
  const [isUploading, setIsUploading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [protocolPreview, setProtocolPreview] = useState("");
  const [acrfPreview, setAcrfPreview] = useState("");
  const [extractionDone, setExtractionDone] = useState(false);
  const [uploadCompleted, setUploadCompleted] = useState(false);

  const canUpload = Boolean(studyId.trim() && protocolFile && acrfFile && !isUploading && !isExtracting);
  const canExtract = Boolean(studyId.trim() && !isUploading && !isExtracting);
  const shouldShowAutoRunProgress = extractionDone || isAutoRunning || Boolean(autoRunMessage || autoRunError);

  useEffect(() => {
    setUploadCompleted(false);
    setExtractionDone(false);
  }, [studyId]);

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
      setUploadCompleted(true);
      setExtractionDone(false);
      setStatus(`Uploaded protocol and aCRF to blob paths: ${response.protocolBlob} and ${response.acrfBlob}`);
    } catch (uploadError) {
      setUploadCompleted(false);
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleExtract(): Promise<void> {
    if (!studyId.trim()) {
      return;
    }
    setError("");
    setStatus("");
    setIsExtracting(true);
    try {
      const extract = await runStep1Extraction(studyId.trim(), extractorChoice);
      onStatusesChange(extract.stepStatuses);
      const preview = await fetchStep1Preview(studyId.trim());
      onStatusesChange(preview.stepStatuses);
      setProtocolPreview(preview.protocolPreview);
      setAcrfPreview(preview.acrfPreview);
      const used = extract.extractor ?? preview.extractor ?? extractorChoice;
      const label =
        used === "opendataloader"
          ? EXTRACTOR_LABELS.opendataloader
          : used === "document_intelligence"
            ? EXTRACTOR_LABELS.document_intelligence
            : "OpenDataLoader + Document Intelligence";
      setStatus(`Extraction completed (${label}). Preview loaded.`);
      setExtractionDone(true);
    } catch (extractError) {
      setError(extractError instanceof Error ? extractError.message : "Extraction failed.");
    } finally {
      setIsExtracting(false);
    }
  }

  return (
    <section className="step1-panel" aria-label="Step 1 execution">
      <h3>Run Step 1 with Real Inputs</h3>
      <p className="step1-subtitle">
        Upload protocol + aCRF PDFs, choose how PDFs are converted to markdown, run extraction, then proceed to Step 2.
      </p>

      <fieldset className="step1-extractor-fieldset">
        <legend className="control-label">PDF extractor</legend>
        <div className="step1-extractor-options">
          <label className="step1-radio-label">
            <input
              type="radio"
              name="pdf-extractor"
              value="both"
              checked={extractorChoice === "both"}
              onChange={() => setExtractorChoice("both")}
            />
            <span>{EXTRACTOR_LABELS.both}</span>
          </label>
          <label className="step1-radio-label">
            <input
              type="radio"
              name="pdf-extractor"
              value="document_intelligence"
              checked={extractorChoice === "document_intelligence"}
              onChange={() => setExtractorChoice("document_intelligence")}
            />
            <span>{EXTRACTOR_LABELS.document_intelligence}</span>
          </label>
          <label className="step1-radio-label">
            <input
              type="radio"
              name="pdf-extractor"
              value="opendataloader"
              checked={extractorChoice === "opendataloader"}
              onChange={() => setExtractorChoice("opendataloader")}
            />
            <span>{EXTRACTOR_LABELS.opendataloader}</span>
          </label>
        </div>
        <p className="step1-note">
          Auto mode uses OpenDataLoader for protocol and Document Intelligence for aCRF TOC compatibility.
        </p>
        {extractorChoice === "opendataloader" ? (
          <p className="step1-warning">
            OpenDataLoader-only may fail at Step 3 if aCRF markdown does not contain TOC rows.
          </p>
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
            onChange={(event) => {
              setProtocolFile(event.target.files?.[0] ?? null);
              setUploadCompleted(false);
              setExtractionDone(false);
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
            onChange={(event) => {
              setAcrfFile(event.target.files?.[0] ?? null);
              setUploadCompleted(false);
              setExtractionDone(false);
            }}
          />
        </label>
      </div>

      <div className="step1-actions">
        <button className="button" type="button" onClick={() => void handleUpload()} disabled={!canUpload}>
          {isUploading ? "Uploading..." : "Upload protocol + aCRF"}
        </button>
        <button className="button" type="button" onClick={() => void handleExtract()} disabled={!canExtract}>
          {isExtracting ? "Extracting..." : "Perform extraction"}
        </button>
        <button
          className="button"
          type="button"
          onClick={() => void onRunToDmReview()}
          disabled={!extractionDone || isUploading || isExtracting || isAutoRunning}
        >
          {isAutoRunning ? "Running to DM revision..." : "Run to DM revision"}
        </button>
        <button className="button button-secondary" type="button" onClick={onMoveNext} disabled={!extractionDone}>
          Move to Step 2
        </button>
      </div>

      {!uploadCompleted ? (
        <p className="step1-note">Upload protocol + aCRF for a new study, or extract an already loaded blob study.</p>
      ) : null}
      {isExtracting ? (
        <div className="step1-extraction-progress" role="status" aria-live="polite" aria-label="Extraction in progress">
          <span className="step1-extraction-circle" aria-hidden="true" />
          <span>Extraction in progress. Please wait...</span>
        </div>
      ) : null}
      {status ? <p className="step1-status">{status}</p> : null}
      {error ? <p className="step1-error">{error}</p> : null}
      {autoRunMessage ? <p className="step1-status">{autoRunMessage}</p> : null}
      {autoRunError ? <p className="step1-error">{autoRunError}</p> : null}

      {shouldShowAutoRunProgress ? (
        <div className="auto-run-progress" aria-live="polite" aria-label="Automatic run progress">
          {autoRunProgress.map((item) => (
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

      {protocolPreview || acrfPreview ? (
        <div className="step1-preview-grid">
          <article className="preview-item preview-item-highlight">
            <p className="preview-title">Protocol extraction preview</p>
            <pre className="preview-body">{protocolPreview || "No preview found yet."}</pre>
          </article>
          <article className="preview-item preview-item-highlight">
            <p className="preview-title">aCRF extraction preview</p>
            <pre className="preview-body">{acrfPreview || "No preview found yet."}</pre>
          </article>
        </div>
      ) : null}
    </section>
  );
}
