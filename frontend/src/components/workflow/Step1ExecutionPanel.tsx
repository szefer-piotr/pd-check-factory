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
      setStatus(`Uploaded to ${response.protocolBlob} and ${response.acrfBlob}`);
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
      setStatus("Extraction completed. Preview loaded.");
      setExtractionDone(true);
    } catch (extractError) {
      setError(extractError instanceof Error ? extractError.message : "Extraction failed.");
    } finally {
      setIsExtracting(false);
    }
  }

  return (
    <section className="workflow-panel step1-panel" aria-label="Step 1 execution">
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
              />
              <span>{EXTRACTOR_LABELS[value]}</span>
            </label>
          ))}
        </div>
        {extractorChoice === "opendataloader" ? (
          <p className="step1-warning">OpenDataLoader-only may fail at Step 3 without TOC rows.</p>
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
        <button className="button button-secondary" type="button" onClick={() => void handleUpload()} disabled={!canUpload}>
          {isUploading ? "Uploading…" : "Upload"}
        </button>
        <button className="button button-primary" type="button" onClick={() => void handleExtract()} disabled={!canExtract}>
          {isExtracting ? "Extracting…" : "Extract"}
        </button>
        <button
          className="button button-optional"
          type="button"
          onClick={() => void onRunToDmReview()}
          disabled={!extractionDone || isUploading || isExtracting || isAutoRunning}
        >
          {isAutoRunning ? "Running pipeline…" : "Run to review"}
        </button>
        <button className="button button-ghost" type="button" onClick={onMoveNext} disabled={!extractionDone}>
          Next step
        </button>
      </div>

      {!uploadCompleted ? <p className="step1-note">Upload PDFs for a new study, or extract an existing blob study.</p> : null}
      {isExtracting ? (
        <div className="step1-extraction-progress" role="status" aria-live="polite">
          <span className="step1-extraction-circle" aria-hidden="true" />
          <span>Extracting…</span>
        </div>
      ) : null}
      {status ? <p className="step1-status">{status}</p> : null}
      {error ? <p className="step1-error">{error}</p> : null}
      {autoRunMessage ? <p className="step1-status">{autoRunMessage}</p> : null}
      {autoRunError ? <p className="step1-error">{autoRunError}</p> : null}

      {shouldShowAutoRunProgress ? (
        <div className="auto-run-progress" aria-live="polite">
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
          <article className="preview-item">
            <p className="preview-title">Protocol preview</p>
            <pre className="preview-body">{protocolPreview || "No preview yet."}</pre>
          </article>
          <article className="preview-item">
            <p className="preview-title">aCRF preview</p>
            <pre className="preview-body">{acrfPreview || "No preview yet."}</pre>
          </article>
        </div>
      ) : null}
    </section>
  );
}
