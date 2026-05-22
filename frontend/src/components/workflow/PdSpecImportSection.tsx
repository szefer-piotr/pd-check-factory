import { useCallback, useEffect, useState } from "react";
import {
  fetchImportVersions,
  fetchStep1UploadStatus,
  runStep,
  setActiveDeviationsSource,
  uploadPdSpecWorkbook,
  type ImportSourceOption,
  type Step1UploadSlotStatus,
  type StepStatus
} from "../../services/stepApi";

interface PdSpecImportSectionProps {
  studyId: string;
  backendStatuses: Record<string, StepStatus>;
  onStatusesChange: (statuses: Record<string, StepStatus>) => void;
  disabled?: boolean;
  compact?: boolean;
  onPreviewPdSpec?: () => void;
}

const defaultPdSpecSlot = (): Step1UploadSlotStatus => ({
  uploaded: false,
  fileName: "pd_specifications.xlsx",
  size: 0,
  blob: ""
});

export function PdSpecImportSection({
  studyId,
  backendStatuses,
  onStatusesChange,
  disabled = false,
  compact = false,
  onPreviewPdSpec
}: PdSpecImportSectionProps): JSX.Element {
  const [pdSpecFile, setPdSpecFile] = useState<File | null>(null);
  const [pdSpecSlot, setPdSpecSlot] = useState<Step1UploadSlotStatus>(defaultPdSpecSlot);
  const [uploadMessage, setUploadMessage] = useState("");
  const [uploadError, setUploadError] = useState("");
  const [runMessage, setRunMessage] = useState("");
  const [runError, setRunError] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const [isLoadingStatus, setIsLoadingStatus] = useState(false);
  const [sources, setSources] = useState<ImportSourceOption[]>([]);
  const [activeSource, setActiveSource] = useState<string>("");

  const refreshPdSpecStatus = useCallback(async (): Promise<void> => {
    const trimmed = studyId.trim();
    if (!trimmed) {
      setPdSpecSlot(defaultPdSpecSlot());
      return;
    }
    setIsLoadingStatus(true);
    try {
      const status = await fetchStep1UploadStatus(trimmed);
      setPdSpecSlot(status.pdSpec ?? defaultPdSpecSlot());
      onStatusesChange(status.stepStatuses);
    } catch {
      setPdSpecSlot(defaultPdSpecSlot());
    } finally {
      setIsLoadingStatus(false);
    }
  }, [onStatusesChange, studyId]);

  const refreshVersions = useCallback(async (): Promise<void> => {
    if (!studyId.trim()) {
      return;
    }
    try {
      const response = await fetchImportVersions(studyId.trim());
      setSources(response.sources);
      setActiveSource(response.activeDeviationsSource ?? "");
    } catch {
      // ignore
    }
  }, [studyId]);

  useEffect(() => {
    void refreshPdSpecStatus();
  }, [refreshPdSpecStatus]);

  useEffect(() => {
    void refreshVersions();
  }, [refreshVersions]);

  async function handleUpload(): Promise<void> {
    if (!studyId.trim() || !pdSpecFile || isUploading) {
      return;
    }
    setIsUploading(true);
    setUploadMessage("");
    setUploadError("");
    try {
      const result = await uploadPdSpecWorkbook(studyId.trim(), pdSpecFile);
      setUploadMessage(`Uploaded ${result.pdSpecFileName ?? "PD Specifications workbook"} to blob storage.`);
      setPdSpecSlot({
        uploaded: true,
        fileName: result.pdSpecFileName ?? pdSpecFile.name,
        size: result.pdSpecSize ?? pdSpecFile.size,
        blob: result.pdSpecBlob
      });
      setPdSpecFile(null);
      onStatusesChange(result.stepStatuses);
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Upload failed.");
    } finally {
      setIsUploading(false);
    }
  }

  async function handleRunImportGround(): Promise<void> {
    if (!studyId.trim() || isRunning) {
      return;
    }
    setIsRunning(true);
    setRunMessage("");
    setRunError("");
    try {
      const result = await runStep(studyId.trim(), "import-pd-spec-ground");
      setRunMessage(result.summary);
      onStatusesChange(result.stepStatuses);
      await refreshVersions();
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Import & grounding failed.");
    } finally {
      setIsRunning(false);
    }
  }

  async function handleRunMerge(): Promise<void> {
    if (!studyId.trim() || isRunning) {
      return;
    }
    setIsRunning(true);
    setRunMessage("");
    setRunError("");
    try {
      const result = await runStep(studyId.trim(), "merge-pd-spec-imports");
      setRunMessage(result.summary);
      onStatusesChange(result.stepStatuses);
      await refreshVersions();
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Merge failed.");
    } finally {
      setIsRunning(false);
    }
  }

  async function handleSelectSource(sourceKey: string): Promise<void> {
    if (!studyId.trim() || !sourceKey) {
      return;
    }
    try {
      const result = await setActiveDeviationsSource(studyId.trim(), sourceKey);
      setActiveSource(result.activeDeviationsSource);
      setRunMessage(`Active source set to ${result.activeDeviationsSource} (${result.deviationCount} deviations).`);
      onStatusesChange(result.stepStatuses);
    } catch (error) {
      setRunError(error instanceof Error ? error.message : "Unable to set active source.");
    }
  }

  const canRunImport = backendStatuses["acrf-summary-text"] === "done" && backendStatuses["index-protocol"] === "done";
  const importCount = sources.filter((s) => s.type === "import").length;
  const hasPdSpecInBlob = pdSpecSlot.uploaded;

  return (
    <div className={`pd-spec-import-section ${compact ? "pd-spec-import-section-compact" : ""}`}>
      {!compact ? (
        <p className="step7-muted pd-spec-import-lead">
          Import a company PD Specifications workbook, or generate rules and deviations from the protocol. After two
          import versions exist, run semantic merge to combine them.
        </p>
      ) : null}

      <div className="stack gap-2">
        <label className="control-label" htmlFor="pd-spec-upload">
          PD Specifications workbook (.xlsx)
        </label>
        {isLoadingStatus ? (
          <p className="step7-muted" role="status">
            Checking blob storage for PD Specifications workbook…
          </p>
        ) : null}
        {hasPdSpecInBlob ? (
          <p className="step1-status" role="status">
            Loaded from blob: <strong>{pdSpecSlot.fileName}</strong>
            {pdSpecSlot.size > 0 ? ` (${Math.round(pdSpecSlot.size / 1024)} KB)` : null}
            {pdSpecSlot.blob ? (
              <>
                <br />
                <span className="upload-card-blob-path">{pdSpecSlot.blob}</span>
              </>
            ) : null}
          </p>
        ) : studyId.trim() ? (
          <p className="step7-muted">No PD Specifications workbook in blob storage for this study yet.</p>
        ) : null}
        <input
          id="pd-spec-upload"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          disabled={disabled || isUploading}
          onChange={(event) => {
            setPdSpecFile(event.target.files?.[0] ?? null);
            setUploadError("");
          }}
        />
        <div className="step1-actions">
          <button
            type="button"
            className="button button-secondary"
            disabled={disabled || isUploading || !pdSpecFile}
            onClick={() => void handleUpload()}
          >
            {isUploading ? "Uploading…" : hasPdSpecInBlob ? "Replace PD spec" : "Upload PD spec"}
          </button>
          {onPreviewPdSpec ? (
            <button
              type="button"
              className="button button-secondary"
              disabled={disabled || !studyId.trim() || !hasPdSpecInBlob}
              onClick={onPreviewPdSpec}
            >
              Preview workbook
            </button>
          ) : null}
        </div>
        {uploadMessage ? <p className="step1-status">{uploadMessage}</p> : null}
        {uploadError ? <p className="step1-error">{uploadError}</p> : null}
        {!canRunImport && studyId.trim() ? (
          <p className="step7-muted">Complete extraction (paragraph index and aCRF summary) before import & grounding.</p>
        ) : null}
      </div>

      <div className="step1-actions">
        <button
          type="button"
          className="button button-optional"
          disabled={disabled || isRunning || !canRunImport || !hasPdSpecInBlob}
          onClick={() => void handleRunImportGround()}
        >
          {isRunning ? "Running…" : "Run import & grounding"}
        </button>
        <button
          type="button"
          className="button button-secondary"
          disabled={disabled || isRunning || importCount < 2}
          title={importCount < 2 ? "Requires at least two import snapshots" : undefined}
          onClick={() => void handleRunMerge()}
        >
          Run semantic merge
        </button>
      </div>

      {sources.length > 0 ? (
        <div className="stack gap-2">
          <p className="control-label">Active deviations source</p>
          <div className="stack gap-1">
            {sources.map((source) => (
              <label key={source.key} className="step1-radio-label">
                <input
                  type="radio"
                  name="active-deviations-source"
                  checked={activeSource === source.key}
                  disabled={disabled}
                  onChange={() => void handleSelectSource(source.key)}
                />
                <span>{source.label}</span>
              </label>
            ))}
          </div>
        </div>
      ) : hasPdSpecInBlob && canRunImport ? (
        <p className="step7-muted">Run import & grounding to create the first snapshot.</p>
      ) : null}

      {runMessage ? <p className="step1-status">{runMessage}</p> : null}
      {runError ? <p className="step1-error">{runError}</p> : null}
    </div>
  );
}
