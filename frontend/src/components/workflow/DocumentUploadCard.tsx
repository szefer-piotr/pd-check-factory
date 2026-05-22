import type { DocumentUploadState } from "../../hooks/useStudyPipelineState";

interface DocumentUploadCardProps {
  label: string;
  inputId: string;
  slot: DocumentUploadState;
  disabled?: boolean;
  onFileSelected: (file: File) => void;
  onRetry?: () => void;
  onPreview?: () => void;
  previewDisabled?: boolean;
  previewLabel?: string;
  accept?: string;
  chooseLabel?: string;
  preprocessLine?: string;
}

function formatSize(bytes?: number): string {
  if (!bytes) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentUploadCard({
  label,
  inputId,
  slot,
  disabled = false,
  onFileSelected,
  onRetry,
  onPreview,
  previewDisabled = false,
  previewLabel = "Preview",
  accept = ".pdf,application/pdf",
  chooseLabel,
  preprocessLine
}: DocumentUploadCardProps): JSX.Element {
  const filePrompt = chooseLabel ?? (slot.status === "uploaded" ? "Replace PDF" : "Choose PDF");
  const isBusy = slot.status === "uploading";
  const inputDisabled = disabled || isBusy || slot.status === "uploaded";

  return (
    <article className={`upload-card upload-card-${slot.status}`}>
      <h4 className="upload-card-title">{label}</h4>

      {isBusy ? (
        <div className="upload-card-progress" role="status" aria-live="polite">
          <span className="upload-spinner" aria-hidden="true" />
          <div className="upload-card-progress-text">
            <strong>Uploading to blob storage…</strong>
            <span className="step7-muted">{slot.originalFileName ?? "PDF"}</span>
            <span className="upload-progress-bar" aria-hidden="true">
              <span className="upload-progress-bar-fill" />
            </span>
          </div>
        </div>
      ) : null}

      {preprocessLine ? (
        <p className="upload-card-preprocess-status" role="status" aria-live="polite">
          {preprocessLine}
        </p>
      ) : null}

      <label className="control-group" htmlFor={inputId}>
        <span className="control-label">{filePrompt}</span>
        <input
          id={inputId}
          className="input"
          type="file"
          accept={accept}
          disabled={inputDisabled}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              onFileSelected(file);
            }
            event.target.value = "";
          }}
        />
      </label>

      <div className="upload-card-status" role="status" aria-live="polite">
        {slot.status === "missing" ? <span className="step7-muted">Not in blob storage yet</span> : null}
        {slot.status === "selected" ? (
          <span className="upload-card-pending">
            Selected: <strong>{slot.originalFileName}</strong>
            {slot.sizeBytes ? ` (${formatSize(slot.sizeBytes)})` : ""} — starting upload…
          </span>
        ) : null}
        {slot.status === "uploaded" ? (
          <div className="upload-card-success-block">
            <span className="upload-card-success">
              <span className="upload-check" aria-hidden="true">✓</span>
              Loaded in blob: <strong>{slot.originalFileName}</strong>
              {slot.sizeBytes ? ` (${formatSize(slot.sizeBytes)})` : ""}
            </span>
            {slot.blobPath ? <span className="upload-card-blob-path">{slot.blobPath}</span> : null}
          </div>
        ) : null}
        {slot.status === "error" ? (
          <div className="upload-card-error-block">
            <p className="step1-error">{slot.error ?? "Upload failed"}</p>
            {onRetry ? (
              <button className="button button-secondary" type="button" onClick={onRetry}>
                Retry upload
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {onPreview && slot.status === "uploaded" ? (
        <button
          className="button button-secondary upload-card-preview-btn"
          type="button"
          onClick={onPreview}
          disabled={previewDisabled || disabled}
        >
          {previewLabel}
        </button>
      ) : null}
    </article>
  );
}
