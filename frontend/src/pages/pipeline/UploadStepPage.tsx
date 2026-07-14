import { useEffect, useState } from "react";
import { Card } from "../../components/layout/Card";
import { Stack } from "../../components/layout/Stack";
import {
  fetchStep1UploadStatus,
  uploadStep1File,
  type Step1UploadStatusResponse,
  type StepStatus
} from "../../services/stepApi";

interface UploadStepPageProps {
  studyId: string;
  onStatusesChange: (statuses: Record<string, StepStatus>) => void;
  onBothUploadedChange?: (bothUploaded: boolean) => void;
  onRefreshSummary?: () => Promise<void>;
}

function formatBytes(size: number): string {
  if (size <= 0) {
    return "";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

interface UploadSlotCardProps {
  title: string;
  uploaded: boolean;
  fileName: string;
  size: number;
  blobPath: string;
  selectedFile: File | null;
  uploading: boolean;
  disabled: boolean;
  onFileChange: (file: File | null) => void;
  onUpload: () => void;
}

function UploadSlotCard({
  title,
  uploaded,
  fileName,
  size,
  blobPath,
  selectedFile,
  uploading,
  disabled,
  onFileChange,
  onUpload
}: UploadSlotCardProps): JSX.Element {
  return (
    <div className={`upload-card ${uploaded ? "upload-card-done" : ""}`}>
      <div className="upload-card-header">
        <h3 className="upload-card-title">{title}</h3>
        <span className={`dep-chip ${uploaded ? "dep-chip-done" : "dep-chip-missing"}`}>
          {uploaded ? "Uploaded" : "Missing"}
        </span>
      </div>

      {uploaded ? (
        <div className="upload-card-success-block">
          <p className="upload-card-success">
            <span className="upload-check" aria-hidden="true">
              ✓
            </span>
            Stored in blob
          </p>
          <p className="upload-card-blob-path">
            {fileName}
            {size > 0 ? ` · ${formatBytes(size)}` : ""}
          </p>
          <p className="upload-card-blob-path">{blobPath}</p>
        </div>
      ) : (
        <p className="upload-card-pending">No file in blob storage yet.</p>
      )}

      <label className="pipeline-field">
        <span>{uploaded ? "Replace file" : "Choose file"}</span>
        <input
          type="file"
          accept=".pdf,application/pdf"
          disabled={disabled}
          onChange={(event) => onFileChange(event.target.files?.[0] ?? null)}
        />
      </label>
      {selectedFile ? <p className="upload-card-pending">Selected: {selectedFile.name}</p> : null}
      <button type="button" disabled={!selectedFile || disabled} onClick={onUpload}>
        {uploading ? "Uploading…" : uploaded ? `Re-upload ${title}` : `Upload ${title}`}
      </button>
    </div>
  );
}

export function UploadStepPage({
  studyId,
  onStatusesChange,
  onBothUploadedChange,
  onRefreshSummary
}: UploadStepPageProps): JSX.Element {
  const [protocolFile, setProtocolFile] = useState<File | null>(null);
  const [acrfFile, setAcrfFile] = useState<File | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);
  const [statusLoading, setStatusLoading] = useState(false);
  const [protocolUploaded, setProtocolUploaded] = useState(false);
  const [acrfUploaded, setAcrfUploaded] = useState(false);
  const [bothUploaded, setBothUploaded] = useState(false);
  const [protocolName, setProtocolName] = useState("");
  const [acrfName, setAcrfName] = useState("");
  const [protocolSize, setProtocolSize] = useState(0);
  const [acrfSize, setAcrfSize] = useState(0);
  const [protocolBlob, setProtocolBlob] = useState("");
  const [acrfBlob, setAcrfBlob] = useState("");

  function applyUploadStatus(status: Step1UploadStatusResponse): void {
    setProtocolName(status.protocol.fileName || "");
    setAcrfName(status.acrf.fileName || "");
    setProtocolSize(status.protocol.size);
    setAcrfSize(status.acrf.size);
    setProtocolBlob(status.protocol.blob || "");
    setAcrfBlob(status.acrf.blob || "");
    setProtocolUploaded(status.protocol.uploaded);
    setAcrfUploaded(status.acrf.uploaded);
    setBothUploaded(status.bothUploaded);
    onStatusesChange(status.stepStatuses);
    onBothUploadedChange?.(status.bothUploaded);
  }

  async function refreshStatus(): Promise<void> {
    if (!studyId.trim()) {
      return;
    }
    const status = await fetchStep1UploadStatus(studyId.trim());
    applyUploadStatus(status);
    await onRefreshSummary?.();
  }

  useEffect(() => {
    if (!studyId.trim()) {
      setProtocolUploaded(false);
      setAcrfUploaded(false);
      setBothUploaded(false);
      setProtocolName("");
      setAcrfName("");
      setProtocolSize(0);
      setAcrfSize(0);
      setProtocolBlob("");
      setAcrfBlob("");
      onBothUploadedChange?.(false);
      return;
    }

    let cancelled = false;
    setStatusLoading(true);
    setError("");
    void fetchStep1UploadStatus(studyId.trim())
      .then((status) => {
        if (!cancelled) {
          applyUploadStatus(status);
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load upload status.");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setStatusLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [studyId]);

  async function handleUpload(slot: "protocol" | "acrf"): Promise<void> {
    const file = slot === "protocol" ? protocolFile : acrfFile;
    if (!file || !studyId.trim()) {
      return;
    }
    setUploading(true);
    setError("");
    setMessage("");
    try {
      const result = await uploadStep1File(studyId.trim(), slot, file);
      onStatusesChange(result.stepStatuses);
      onBothUploadedChange?.(result.bothUploaded ?? false);
      if (slot === "protocol") {
        setProtocolFile(null);
      } else {
        setAcrfFile(null);
      }
      await refreshStatus();
      setMessage(
        result.bothUploaded
          ? `Uploaded ${slot === "protocol" ? "protocol" : "aCRF"}. Both documents are now in blob storage.`
          : `Uploaded ${slot === "protocol" ? "protocol" : "aCRF"}.`
      );
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setUploading(false);
    }
  }

  const busy = uploading || statusLoading;

  return (
    <Stack gap="md">
      <div className="pipeline-step-page">
      <header className="pipeline-step-header">
        <div>
          <h1>Upload documents</h1>
          <p className="pipeline-step-description">Upload protocol and annotated CRF PDFs.</p>
        </div>
      </header>

      {error ? <p className="pipeline-error">{error}</p> : null}
      {message ? <p className="pipeline-message">{message}</p> : null}

      {statusLoading ? (
        <div className="upload-rail-banner" role="status" aria-live="polite">
          <span className="upload-spinner" aria-hidden="true" />
          <span>Checking blob storage…</span>
        </div>
      ) : null}

      {!statusLoading && bothUploaded ? (
        <div className="pipeline-upload-complete-banner" role="status">
          <span className="upload-check" aria-hidden="true">
            ✓
          </span>
          Both protocol and aCRF are in blob storage. The Upload step is complete — continue to the next step.
        </div>
      ) : null}

      <Card>
        <Stack gap="md">
          <div className="upload-cards-grid">
            <UploadSlotCard
              title="Protocol PDF"
              uploaded={protocolUploaded}
              fileName={protocolName || "protocol.pdf"}
              size={protocolSize}
              blobPath={protocolBlob}
              selectedFile={protocolFile}
              uploading={uploading}
              disabled={busy || !studyId.trim()}
              onFileChange={setProtocolFile}
              onUpload={() => void handleUpload("protocol")}
            />
            <UploadSlotCard
              title="aCRF PDF"
              uploaded={acrfUploaded}
              fileName={acrfName || "acrf.pdf"}
              size={acrfSize}
              blobPath={acrfBlob}
              selectedFile={acrfFile}
              uploading={uploading}
              disabled={busy || !studyId.trim()}
              onFileChange={setAcrfFile}
              onUpload={() => void handleUpload("acrf")}
            />
          </div>

          <button
            type="button"
            className="secondary"
            disabled={busy || !studyId.trim()}
            onClick={() => {
              setStatusLoading(true);
              setError("");
              void refreshStatus()
                .catch((refreshError) => {
                  setError(refreshError instanceof Error ? refreshError.message : "Unable to load upload status.");
                })
                .finally(() => setStatusLoading(false));
            }}
          >
            Refresh upload status
          </button>
        </Stack>
      </Card>
      </div>
    </Stack>
  );
}
