import { useState } from "react";
import type { DocumentUploadState } from "../../hooks/useStudyPipelineState";

export interface UploadRailSlot {
  id: "protocol" | "acrf" | "pdSpec";
  label: string;
  shortLabel: string;
  inputId: string;
  slot: DocumentUploadState;
  accept?: string;
  chooseLabel?: string;
  preprocessLine?: string;
  previewLabel?: string;
  previewDisabled?: boolean;
  onFileSelected: (file: File) => void;
  onRetry?: () => void;
  onPreview?: () => void;
}

interface UploadRailProps {
  slots: UploadRailSlot[];
  disabled?: boolean;
  studySelected: boolean;
  isLoadingUploadStatus?: boolean;
  uploadStatusError?: string;
}

function statusDotClass(status: DocumentUploadState["status"]): string {
  switch (status) {
    case "uploaded":
      return "upload-rail-dot-done";
    case "uploading":
    case "selected":
      return "upload-rail-dot-running";
    case "error":
      return "upload-rail-dot-error";
    default:
      return "upload-rail-dot-pending";
  }
}

function statusLabel(slot: UploadRailSlot): string {
  const { slot: state, preprocessLine } = slot;
  if (state.status === "uploading") {
    return "Uploading…";
  }
  if (state.status === "selected") {
    return "Starting…";
  }
  if (state.status === "error") {
    return "Failed";
  }
  if (state.status === "uploaded") {
    return preprocessLine ?? "Ready";
  }
  return "Missing";
}

function fileName(slot: UploadRailSlot): string {
  if (slot.slot.originalFileName) {
    return slot.slot.originalFileName;
  }
  return "No file";
}

export function UploadRail({
  slots,
  disabled = false,
  studySelected,
  isLoadingUploadStatus = false,
  uploadStatusError = ""
}: UploadRailProps): JSX.Element {
  const [expandedId, setExpandedId] = useState<UploadRailSlot["id"] | null>(null);

  return (
    <div className="upload-rail" aria-label="Source document uploads">
      {isLoadingUploadStatus ? (
        <div className="upload-rail-banner" role="status" aria-live="polite">
          <span className="upload-spinner" aria-hidden="true" />
          <span>Checking blob storage…</span>
        </div>
      ) : null}
      {uploadStatusError ? <p className="step1-error">{uploadStatusError}</p> : null}

      <div className="upload-rail-chips" role="list">
        {slots.map((slot) => {
          const isExpanded = expandedId === slot.id;
          const chipDisabled = disabled || isLoadingUploadStatus || !studySelected;
          const isUploading = slot.slot.status === "uploading";

          return (
            <div className="upload-rail-item" role="listitem" key={slot.id}>
              <button
                type="button"
                className={`upload-rail-chip ${isExpanded ? "upload-rail-chip-expanded" : ""}`}
                onClick={() => setExpandedId(isExpanded ? null : slot.id)}
                aria-expanded={isExpanded}
              >
                <span className={`upload-rail-dot ${statusDotClass(slot.slot.status)}`} aria-hidden="true" />
                <span className="upload-rail-chip-text">
                  <span className="upload-rail-chip-label">{slot.shortLabel}</span>
                  <span className="upload-rail-chip-filename">{fileName(slot)}</span>
                </span>
                <span className="upload-rail-chip-status">{statusLabel(slot)}</span>
              </button>

              {isExpanded ? (
                <div className="upload-rail-detail">
                  <p className="upload-rail-detail-title">{slot.label}</p>
                  {isUploading ? (
                    <div className="upload-card-progress" role="status" aria-live="polite">
                      <span className="upload-spinner" aria-hidden="true" />
                      <span>Uploading to blob storage…</span>
                    </div>
                  ) : null}
                  {slot.slot.status === "error" ? (
                    <div className="upload-card-error-block">
                      <p className="step1-error">{slot.slot.error ?? "Upload failed"}</p>
                      {slot.onRetry ? (
                        <button className="button button-secondary" type="button" onClick={slot.onRetry}>
                          Retry upload
                        </button>
                      ) : null}
                    </div>
                  ) : null}
                  <label className="control-group" htmlFor={slot.inputId}>
                    <span className="control-label">
                      {slot.chooseLabel ??
                        (slot.slot.status === "uploaded" ? "Replace file" : "Choose file")}
                    </span>
                    <input
                      id={slot.inputId}
                      className="input"
                      type="file"
                      accept={slot.accept ?? ".pdf,application/pdf"}
                      disabled={chipDisabled || isUploading}
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) {
                          slot.onFileSelected(file);
                        }
                        event.target.value = "";
                      }}
                    />
                  </label>
                  {slot.onPreview && slot.slot.status === "uploaded" ? (
                    <button
                      className="button button-secondary"
                      type="button"
                      onClick={slot.onPreview}
                      disabled={chipDisabled || slot.previewDisabled}
                    >
                      {slot.previewLabel ?? "Preview"}
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      {!studySelected ? (
        <p className="step7-muted upload-rail-hint">Select or create a study before uploading documents.</p>
      ) : null}
    </div>
  );
}
