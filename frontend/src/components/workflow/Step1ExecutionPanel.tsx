import { useState } from "react";
import type { StepStatus } from "../../services/stepApi";
import { fetchStep1Preview, runStep1Extraction, uploadStep1Files } from "../../services/stepApi";

interface Step1ExecutionPanelProps {
  studyId: string;
  onMoveNext: () => void;
  onStatusesChange: (statuses: Record<string, StepStatus>) => void;
}

export function Step1ExecutionPanel({ studyId, onMoveNext, onStatusesChange }: Step1ExecutionPanelProps): JSX.Element {
  const [protocolFile, setProtocolFile] = useState<File | null>(null);
  const [acrfFile, setAcrfFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isExtracting, setIsExtracting] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [protocolPreview, setProtocolPreview] = useState("");
  const [acrfPreview, setAcrfPreview] = useState("");
  const [extractionDone, setExtractionDone] = useState(false);

  const canUpload = Boolean(studyId.trim() && protocolFile && acrfFile && !isUploading && !isExtracting);

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
      setStatus(`Uploaded protocol and aCRF to blob paths: ${response.protocolBlob} and ${response.acrfBlob}`);
    } catch (uploadError) {
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
      const extract = await runStep1Extraction(studyId.trim());
      onStatusesChange(extract.stepStatuses);
      const preview = await fetchStep1Preview(studyId.trim());
      onStatusesChange(preview.stepStatuses);
      setProtocolPreview(preview.protocolPreview);
      setAcrfPreview(preview.acrfPreview);
      setStatus("Extraction completed successfully. Preview loaded.");
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
      <p className="step1-subtitle">Upload protocol + aCRF PDFs, run extraction, then proceed to Step 2.</p>

      <div className="step1-inputs">
        <label className="control-group" htmlFor="protocol-file">
          <span className="control-label">Protocol PDF</span>
          <input
            id="protocol-file"
            className="input"
            type="file"
            accept=".pdf,application/pdf"
            onChange={(event) => setProtocolFile(event.target.files?.[0] ?? null)}
          />
        </label>
        <label className="control-group" htmlFor="acrf-file">
          <span className="control-label">aCRF PDF</span>
          <input
            id="acrf-file"
            className="input"
            type="file"
            accept=".pdf,application/pdf"
            onChange={(event) => setAcrfFile(event.target.files?.[0] ?? null)}
          />
        </label>
      </div>

      <div className="step1-actions">
        <button className="button" type="button" onClick={() => void handleUpload()} disabled={!canUpload}>
          {isUploading ? "Uploading..." : "Upload protocol + aCRF"}
        </button>
        <button className="button" type="button" onClick={() => void handleExtract()} disabled={!studyId.trim() || isUploading || isExtracting}>
          {isExtracting ? "Extracting..." : "Perform extraction"}
        </button>
        <button className="button button-secondary" type="button" onClick={onMoveNext} disabled={!extractionDone}>
          Move to Step 2
        </button>
      </div>

      {status ? <p className="step1-status">{status}</p> : null}
      {error ? <p className="step1-error">{error}</p> : null}

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
