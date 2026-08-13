import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Card } from "../../components/layout/Card";
import { Stack } from "../../components/layout/Stack";
import { PipelineLogDrawer } from "../../components/pipeline/PipelineLogDrawer";
import { DocumentPreviewModal, type DocumentPreviewKind } from "../../components/workflow/DocumentPreviewModal";
import { LlmProgressBar } from "../../components/workflow/LlmProgressBar";
import { usePipelineRunState } from "../../hooks/usePipelineRunState";
import { usePipelineJobs } from "../../jobs/PipelineJobContext";
import {
  fetchStep1Preview,
  fetchStep1UploadStatus,
  fetchStepPreview,
  uploadStep1File,
  type Step1UploadStatusResponse,
  type StepStatus
} from "../../services/stepApi";
import {
  extractAcrfSummaryFromJson,
  tryParseJson,
  type AcrfSummaryPreviewRow
} from "../../utils/previewFormat";

type PreprocessSlotStatus = "idle" | "queued" | "running" | "done" | "failed";
type PreviewTarget = "protocol-md" | "protocol-index" | "acrf-md" | "acrf-summary" | null;
type ChecklistState = "pending" | "running" | "done" | "skipped" | "failed";

interface ProcessingStepPageProps {
  studyId: string;
  onStatusesChange: (statuses: Record<string, StepStatus>) => void;
  onProcessingCompleteChange?: (complete: boolean) => void;
  onRunActiveChange?: (active: boolean) => void;
  onRefreshSummary?: () => Promise<void>;
  /** Hide page header when composed inside Study setup. */
  embedded?: boolean;
  /** Hide local log drawer; use global activity panel instead. */
  hideLocalActivity?: boolean;
}

interface UploadSlotCardProps {
  title: string;
  hint: string;
  uploaded: boolean;
  fileName: string;
  size: number;
  blobPath: string;
  uploading: boolean;
  disabled: boolean;
  preprocessStatus: PreprocessSlotStatus;
  checklist: Array<{ id: string; label: string; state: ChecklistState }>;
  previewButtons: Array<{ label: string; disabled: boolean; onClick: () => void }>;
  canReprocess: boolean;
  reprocessDisabled: boolean;
  onUploadFile: (file: File) => void;
  onReprocess: () => void;
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

function preprocessStatusLabel(status: PreprocessSlotStatus): string {
  switch (status) {
    case "queued":
      return "Queued";
    case "running":
      return "Processing…";
    case "done":
      return "Ready";
    case "failed":
      return "Failed";
    default:
      return "Idle";
  }
}

function UploadSlotCard({
  title,
  hint,
  uploaded,
  fileName,
  size,
  blobPath,
  uploading,
  disabled,
  preprocessStatus,
  checklist,
  previewButtons,
  canReprocess,
  reprocessDisabled,
  onUploadFile,
  onReprocess
}: UploadSlotCardProps): JSX.Element {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);

  function takeFile(file: File | null | undefined): void {
    if (!file || disabled || uploading) {
      return;
    }
    onUploadFile(file);
  }

  return (
    <div className={`upload-card ${uploaded ? "upload-card-done" : ""}`}>
      <div className="upload-card-header">
        <h3 className="upload-card-title">{title}</h3>
        <span className={`dep-chip ${uploaded ? "dep-chip-done" : "dep-chip-missing"}`}>
          {uploading ? "Uploading…" : uploaded ? "Uploaded" : "Missing"}
        </span>
      </div>

      {uploaded ? (
        <div
          className="file-chip"
          title={blobPath || undefined}
        >
          <span className="upload-check" aria-hidden="true">
            ✓
          </span>
          <span className="file-chip-meta">
            <strong>{fileName}</strong>
            <span>
              {size > 0 ? formatBytes(size) : "Stored in blob"}
              {preprocessStatus !== "idle" ? ` · ${preprocessStatusLabel(preprocessStatus)}` : ""}
            </span>
          </span>
        </div>
      ) : (
        <button
          type="button"
          className={`drop-zone ${dragOver ? "is-dragover" : ""}`}
          disabled={disabled || uploading}
          onClick={() => inputRef.current?.click()}
          onDragEnter={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragOver={(event) => {
            event.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={(event) => {
            event.preventDefault();
            setDragOver(false);
          }}
          onDrop={(event) => {
            event.preventDefault();
            setDragOver(false);
            takeFile(event.dataTransfer.files?.[0]);
          }}
        >
          <span className="drop-zone-title">{uploading ? "Uploading…" : `Drop ${hint} here`}</span>
          <span className="drop-zone-subtitle">or browse to upload</span>
        </button>
      )}

      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept=".pdf,.xls,.xlsx,application/pdf,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        disabled={disabled || uploading}
        onChange={(event) => {
          takeFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      {uploaded ? (
        <div className="processing-slot-status">
          <ol className="processing-mini-pipeline" aria-label={`${title} processing stages`}>
            {checklist.map((item) => (
              <li key={item.id} className={`processing-mini-step is-${item.state}`}>
                <span className="processing-mini-dot" aria-hidden="true" />
                <span className="processing-mini-label">{item.label}</span>
              </li>
            ))}
          </ol>
          <div className="processing-slot-actions pipeline-actions">
            {previewButtons.map((button) => (
              <button
                key={button.label}
                type="button"
                className="button button-secondary"
                disabled={button.disabled}
                onClick={button.onClick}
              >
                {button.label}
              </button>
            ))}
            <button
              type="button"
              className="button button-ghost"
              disabled={disabled || uploading}
              onClick={() => inputRef.current?.click()}
            >
              Replace
            </button>
            {canReprocess ? (
              <button type="button" className="button button-ghost" disabled={reprocessDisabled} onClick={onReprocess}>
                Re-process
              </button>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function resolveAcrfSourceType(
  status: Step1UploadStatusResponse | null,
  fileName: string
): "pdf" | "xls" | "xlsx" {
  const fromApi = status?.acrfSourceType;
  if (fromApi === "pdf" || fromApi === "xls" || fromApi === "xlsx") {
    return fromApi;
  }
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xls")) {
    return "xls";
  }
  if (lower.endsWith(".xlsx")) {
    return "xlsx";
  }
  return "pdf";
}

export function ProcessingStepPage({
  studyId,
  onStatusesChange,
  onProcessingCompleteChange,
  onRunActiveChange,
  onRefreshSummary,
  embedded = false,
  hideLocalActivity = false
}: ProcessingStepPageProps): JSX.Element {
  const jobs = usePipelineJobs();
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [uploadingSlot, setUploadingSlot] = useState<"protocol" | "acrf" | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<Step1UploadStatusResponse | null>(null);
  const [protocolPreprocess, setProtocolPreprocess] = useState<PreprocessSlotStatus>("idle");
  const [acrfPreprocess, setAcrfPreprocess] = useState<PreprocessSlotStatus>("idle");

  const [previewTarget, setPreviewTarget] = useState<PreviewTarget>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewKind, setPreviewKind] = useState<DocumentPreviewKind>("markdown");
  const [previewMarkdown, setPreviewMarkdown] = useState("");
  const [previewAcrfRows, setPreviewAcrfRows] = useState<AcrfSummaryPreviewRow[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const queueRef = useRef<Array<"protocol" | "acrf">>([]);
  const runningSlotRef = useRef<"protocol" | "acrf" | null>(null);
  const drainRef = useRef<() => void>(() => undefined);

  const isPreprocessActive =
    protocolPreprocess === "running" ||
    protocolPreprocess === "queued" ||
    acrfPreprocess === "running" ||
    acrfPreprocess === "queued";

  const { runState } = usePipelineRunState(studyId, {
    enabled: Boolean(studyId.trim()) && isPreprocessActive,
    pollMs: 1500
  });

  useEffect(() => {
    onRunActiveChange?.(isPreprocessActive);
  }, [isPreprocessActive, onRunActiveChange]);

  const applyUploadStatus = useCallback(
    (status: Step1UploadStatusResponse): void => {
      setUploadStatus(status);
      onStatusesChange(status.stepStatuses);
      const complete = Boolean(status.protocolPreprocessed && status.acrfPreprocessed);
      onProcessingCompleteChange?.(complete);
      if (status.protocolPreprocessed && protocolPreprocess !== "running" && protocolPreprocess !== "queued") {
        setProtocolPreprocess("done");
      }
      if (status.acrfPreprocessed && acrfPreprocess !== "running" && acrfPreprocess !== "queued") {
        setAcrfPreprocess("done");
      }
    },
    [acrfPreprocess, onProcessingCompleteChange, onStatusesChange, protocolPreprocess]
  );

  const refreshStatus = useCallback(async (): Promise<Step1UploadStatusResponse | null> => {
    if (!studyId.trim()) {
      return null;
    }
    const status = await fetchStep1UploadStatus(studyId.trim());
    applyUploadStatus(status);
    await onRefreshSummary?.();
    return status;
  }, [applyUploadStatus, onRefreshSummary, studyId]);

  useEffect(() => {
    if (!studyId.trim()) {
      setUploadStatus(null);
      setProtocolPreprocess("idle");
      setAcrfPreprocess("idle");
      onProcessingCompleteChange?.(false);
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

  const runPreprocessSlot = useCallback(
    async (slot: "protocol" | "acrf"): Promise<void> => {
      const trimmed = studyId.trim();
      if (!trimmed) {
        return;
      }
      runningSlotRef.current = slot;
      if (slot === "protocol") {
        setProtocolPreprocess("running");
      } else {
        setAcrfPreprocess("running");
      }
      setError("");
      setMessage(slot === "protocol" ? "Preparing protocol (extract + index)…" : "Preparing aCRF…");
      try {
        if (slot === "protocol") {
          await jobs.runPreprocessProtocol(trimmed, true);
        } else {
          await jobs.runPreprocessAcrf(trimmed, true);
        }
        if (slot === "protocol") {
          setProtocolPreprocess("done");
        } else {
          setAcrfPreprocess("done");
        }
        setMessage(slot === "protocol" ? "Protocol preprocess finished." : "aCRF preprocess finished.");
        await refreshStatus();
      } catch (preprocessError) {
        if (slot === "protocol") {
          setProtocolPreprocess("failed");
        } else {
          setAcrfPreprocess("failed");
        }
        setError(
          preprocessError instanceof Error ? preprocessError.message : `${slot} preprocess failed.`
        );
        await refreshStatus().catch(() => undefined);
      } finally {
        runningSlotRef.current = null;
        drainRef.current();
      }
    },
    [jobs, refreshStatus, studyId]
  );

  const enqueuePreprocess = useCallback(
    (slot: "protocol" | "acrf"): void => {
      if (runningSlotRef.current === slot || queueRef.current.includes(slot)) {
        return;
      }
      if (runningSlotRef.current) {
        queueRef.current.push(slot);
        if (slot === "protocol") {
          setProtocolPreprocess("queued");
        } else {
          setAcrfPreprocess("queued");
        }
        return;
      }
      void runPreprocessSlot(slot);
    },
    [runPreprocessSlot]
  );

  useEffect(() => {
    drainRef.current = (): void => {
      const next = queueRef.current.shift();
      if (next) {
        void runPreprocessSlot(next);
      }
    };
  }, [runPreprocessSlot]);

  async function handleUpload(slot: "protocol" | "acrf", file: File): Promise<void> {
    if (!file || !studyId.trim()) {
      return;
    }
    setUploadingSlot(slot);
    setError("");
    setMessage("");
    try {
      const result = await uploadStep1File(studyId.trim(), slot, file);
      onStatusesChange(result.stepStatuses);
      await refreshStatus();
      setMessage(`Uploaded ${slot === "protocol" ? "protocol" : "aCRF"}. Starting processing…`);
      enqueuePreprocess(slot);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "Upload failed.");
    } finally {
      setUploadingSlot(null);
    }
  }

  function closePreview(): void {
    setPreviewTarget(null);
    setPreviewError("");
    setPreviewMarkdown("");
    setPreviewAcrfRows([]);
  }

  async function openMarkdownPreview(target: "protocol" | "acrf"): Promise<void> {
    const trimmed = studyId.trim();
    if (!trimmed) {
      return;
    }
    setPreviewTarget(target === "protocol" ? "protocol-md" : "acrf-md");
    setPreviewKind("markdown");
    setPreviewTitle(target === "protocol" ? "Protocol — extracted text" : "aCRF — extracted text");
    setPreviewMarkdown("");
    setPreviewAcrfRows([]);
    setPreviewError("");
    setPreviewLoading(true);
    try {
      const preview = await fetchStep1Preview(trimmed, { full: true });
      onStatusesChange(preview.stepStatuses);
      setPreviewMarkdown(target === "protocol" ? preview.protocolPreview : preview.acrfPreview);
    } catch (loadError) {
      setPreviewError(loadError instanceof Error ? loadError.message : "Unable to load preview.");
    } finally {
      setPreviewLoading(false);
    }
  }

  async function openStepPreview(
    target: "protocol-index" | "acrf-summary",
    stepId: string,
    title: string,
    kind: DocumentPreviewKind
  ): Promise<void> {
    const trimmed = studyId.trim();
    if (!trimmed) {
      return;
    }
    setPreviewTarget(target);
    setPreviewKind(kind);
    setPreviewTitle(title);
    setPreviewMarkdown("");
    setPreviewAcrfRows([]);
    setPreviewError("");
    setPreviewLoading(true);
    try {
      const preview = await fetchStepPreview(trimmed, stepId);
      onStatusesChange(preview.stepStatuses);
      const body = preview.previews[0]?.body ?? "";
      if (kind === "acrf-summary") {
        const parsed = tryParseJson(body);
        setPreviewAcrfRows(parsed ? extractAcrfSummaryFromJson(parsed) : []);
      } else {
        setPreviewMarkdown(body);
      }
    } catch (loadError) {
      setPreviewError(loadError instanceof Error ? loadError.message : "Unable to load preview.");
    } finally {
      setPreviewLoading(false);
    }
  }

  const protocolUploaded = Boolean(uploadStatus?.protocol.uploaded);
  const acrfUploaded = Boolean(uploadStatus?.acrf.uploaded);
  const protocolPreprocessed = Boolean(uploadStatus?.protocolPreprocessed);
  const acrfPreprocessed = Boolean(uploadStatus?.acrfPreprocessed);
  const bothReady = protocolPreprocessed && acrfPreprocessed;
  const acrfSourceType = resolveAcrfSourceType(uploadStatus, uploadStatus?.acrf.fileName ?? "");
  const isXlsAcrf = acrfSourceType === "xls" || acrfSourceType === "xlsx";
  const stepStatuses = uploadStatus?.stepStatuses ?? {};
  const busy = uploadingSlot !== null || statusLoading || isPreprocessActive;

  const protocolChecklist = useMemo(() => {
    const extractState: ChecklistState =
      protocolPreprocess === "failed"
        ? "failed"
        : protocolPreprocess === "running" && stepStatuses["extract-inputs"] !== "done"
          ? "running"
          : stepStatuses["extract-inputs"] === "done" || protocolPreprocessed
            ? "done"
            : "pending";
    const indexState: ChecklistState =
      protocolPreprocess === "failed"
        ? "failed"
        : protocolPreprocess === "running" && extractState === "done"
          ? "running"
          : protocolPreprocessed || stepStatuses["index-protocol"] === "done"
            ? "done"
            : "pending";
    return [
      { id: "upload", label: "Upload", state: (protocolUploaded ? "done" : "pending") as ChecklistState },
      { id: "extract", label: "Extract", state: extractState },
      { id: "index", label: "Index", state: indexState }
    ];
  }, [protocolPreprocess, protocolPreprocessed, protocolUploaded, stepStatuses]);

  const acrfChecklist = useMemo(() => {
    if (isXlsAcrf) {
      return [
        { id: "upload", label: "Upload", state: (acrfUploaded ? "done" : "pending") as ChecklistState },
        {
          id: "summary",
          label: "Summary",
          state: (acrfPreprocess === "failed"
            ? "failed"
            : acrfPreprocess === "running"
              ? "running"
              : acrfPreprocessed || stepStatuses["acrf-summary-text"] === "done"
                ? "done"
                : "pending") as ChecklistState
        }
      ];
    }
    const extractState: ChecklistState =
      acrfPreprocess === "failed"
        ? "failed"
        : acrfPreprocess === "running" && stepStatuses["extract-inputs"] !== "done" && !acrfPreprocessed
          ? "running"
          : stepStatuses["extract-inputs"] === "done" || acrfPreprocessed
            ? "done"
            : "pending";
    const splitState: ChecklistState =
      stepStatuses["acrf-split-toc"] === "skipped"
        ? "skipped"
        : acrfPreprocess === "failed"
          ? "failed"
          : acrfPreprocess === "running" && extractState === "done" && stepStatuses["acrf-split-toc"] !== "done"
            ? "running"
            : stepStatuses["acrf-split-toc"] === "done" || acrfPreprocessed
              ? "done"
              : "pending";
    const summaryState: ChecklistState =
      acrfPreprocess === "failed"
        ? "failed"
        : acrfPreprocess === "running" && (splitState === "done" || splitState === "skipped")
          ? "running"
          : acrfPreprocessed || stepStatuses["acrf-summary-text"] === "done"
            ? "done"
            : "pending";
    return [
      { id: "upload", label: "Upload", state: (acrfUploaded ? "done" : "pending") as ChecklistState },
      { id: "extract", label: "Extract", state: extractState },
      { id: "split", label: "Split", state: splitState },
      { id: "summary", label: "Summary", state: summaryState }
    ];
  }, [acrfPreprocess, acrfPreprocessed, acrfUploaded, isXlsAcrf, stepStatuses]);

  const pageStatus =
    protocolPreprocess === "failed" || acrfPreprocess === "failed"
      ? "failed"
      : isPreprocessActive
        ? "running"
        : bothReady
          ? "done"
          : "idle";

  return (
    <div className={`pipeline-step-page ${embedded ? "pipeline-step-page-embedded" : ""}`}>
      <div className={hideLocalActivity ? "pipeline-step-layout pipeline-step-layout-single" : "pipeline-step-layout"}>
        <div className="pipeline-step-main">
          <Stack gap="md">
            {!embedded ? (
              <header className="pipeline-step-header">
                <div>
                  <h1>Process documents</h1>
                  <p className="pipeline-step-description">
                    Upload protocol and aCRF. Each file is processed end-to-end automatically (extract, index, and
                    aCRF summary as needed).
                  </p>
                </div>
                <span className={`pipeline-step-badge pipeline-step-badge-${pageStatus}`}>
                  {pageStatus === "running"
                    ? "Running"
                    : pageStatus === "failed"
                      ? "Failed"
                      : bothReady
                        ? "Complete"
                        : "Pending"}
                </span>
              </header>
            ) : (
              <div className="study-setup-section-head">
                <h2>Documents &amp; extractions</h2>
                <span className={`pipeline-step-badge pipeline-step-badge-${pageStatus}`}>
                  {pageStatus === "running"
                    ? "Running"
                    : pageStatus === "failed"
                      ? "Failed"
                      : bothReady
                        ? "Complete"
                        : "Required"}
                </span>
              </div>
            )}

            {!hideLocalActivity && isPreprocessActive ? (
              <div className="pipeline-run-banner" role="status">
                Processing in progress — do not close the browser.
              </div>
            ) : null}

            {error ? <p className="pipeline-error">{error}</p> : null}
            {message ? <p className="pipeline-message">{message}</p> : null}

            {statusLoading ? (
              <div className="upload-rail-banner" role="status" aria-live="polite">
                <span className="spinner spinner-sm" aria-hidden="true" />
                <span>Checking blob storage…</span>
              </div>
            ) : null}

            {!statusLoading && bothReady ? (
              <div className="pipeline-upload-complete-banner" role="status">
                <span className="upload-check" aria-hidden="true">
                  ✓
                </span>
                Protocol and aCRF are prepared. Continue to Generate PD when ready.
              </div>
            ) : null}

            <Card>
              <div className="upload-cards-grid">
                  <UploadSlotCard
                    title="Protocol"
                    hint="PDF"
                    uploaded={protocolUploaded}
                    fileName={uploadStatus?.protocol.fileName || "protocol.pdf"}
                    size={uploadStatus?.protocol.size ?? 0}
                    blobPath={uploadStatus?.protocol.blob || ""}
                    uploading={uploadingSlot === "protocol"}
                    disabled={busy || !studyId.trim()}
                    preprocessStatus={protocolPreprocess}
                    checklist={protocolChecklist}
                    previewButtons={[
                      {
                        label: "Preview extracted text",
                        disabled: stepStatuses["extract-inputs"] !== "done" && !protocolPreprocessed,
                        onClick: () => void openMarkdownPreview("protocol")
                      },
                      {
                        label: "Preview index",
                        disabled: !protocolPreprocessed && stepStatuses["index-protocol"] !== "done",
                        onClick: () =>
                          void openStepPreview(
                            "protocol-index",
                            "index-protocol",
                            "Protocol — paragraph index",
                            "markdown"
                          )
                      }
                    ]}
                    canReprocess={protocolUploaded}
                    reprocessDisabled={busy}
                    onUploadFile={(file) => void handleUpload("protocol", file)}
                    onReprocess={() => enqueuePreprocess("protocol")}
                  />
                  <UploadSlotCard
                    title="aCRF"
                    hint="PDF/XLS"
                    uploaded={acrfUploaded}
                    fileName={uploadStatus?.acrf.fileName || "acrf.pdf"}
                    size={uploadStatus?.acrf.size ?? 0}
                    blobPath={uploadStatus?.acrf.blob || ""}
                    uploading={uploadingSlot === "acrf"}
                    disabled={busy || !studyId.trim()}
                    preprocessStatus={acrfPreprocess}
                    checklist={acrfChecklist}
                    previewButtons={[
                      ...(isXlsAcrf
                        ? []
                        : [
                            {
                              label: "Preview extracted text",
                              disabled: stepStatuses["extract-inputs"] !== "done" && !acrfPreprocessed,
                              onClick: () => void openMarkdownPreview("acrf")
                            }
                          ]),
                      {
                        label: "Preview summary",
                        disabled: !acrfPreprocessed && stepStatuses["acrf-summary-text"] !== "done",
                        onClick: () =>
                          void openStepPreview(
                            "acrf-summary",
                            "acrf-summary-text",
                            "aCRF — merged summary",
                            "acrf-summary"
                          )
                      }
                    ]}
                    canReprocess={acrfUploaded}
                    reprocessDisabled={busy}
                    onUploadFile={(file) => void handleUpload("acrf", file)}
                    onReprocess={() => enqueuePreprocess("acrf")}
                  />
              </div>

                {!hideLocalActivity && runState.llmProgress ? <LlmProgressBar progress={runState.llmProgress} /> : null}

                <div className="pipeline-actions" style={{ marginTop: "var(--space-md)" }}>
                  <button
                    type="button"
                    className="button button-secondary"
                    disabled={busy || !studyId.trim()}
                    onClick={() => {
                      setStatusLoading(true);
                      setError("");
                      void refreshStatus()
                        .catch((refreshError) => {
                          setError(
                            refreshError instanceof Error
                              ? refreshError.message
                              : "Unable to load upload status."
                          );
                        })
                        .finally(() => setStatusLoading(false));
                    }}
                  >
                    Refresh status
                  </button>
                </div>
            </Card>
          </Stack>
        </div>

        {!hideLocalActivity ? (
          <PipelineLogDrawer logs={runState.logs} active={isPreprocessActive || runState.status === "running"} />
        ) : null}
      </div>

      <DocumentPreviewModal
        open={previewTarget !== null}
        title={previewTitle}
        kind={previewKind}
        markdownContent={previewMarkdown}
        acrfSummaryRows={previewAcrfRows}
        isLoading={previewLoading}
        error={previewError}
        onClose={closePreview}
      />
    </div>
  );
}
