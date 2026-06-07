import { useCallback, useEffect, useRef, useState } from "react";
import type { PreprocessStatus, UseStudyPipelineStateResult } from "../../hooks/useStudyPipelineState";
import type { DocumentUploadState } from "../../hooks/useStudyPipelineState";
import {
  fetchSpecificationsPreview,
  fetchStep1Preview,
  preprocessAcrf,
  preprocessProtocol,
  uploadPdSpecWorkbook,
  uploadStep1File,
  type Step1PdfExtractor,
  type StepStatus
} from "../../services/stepApi";
import { DocumentUploadCard } from "./DocumentUploadCard";
import { DocumentPreviewModal } from "./DocumentPreviewModal";
import { ExtractionStatusPanel } from "./ExtractionStatusPanel";
import type { ProcessingSubProgressItem } from "./ProcessingPanel";
import { PipelineActionTiles } from "./PipelineActionTiles";
import type { ExtendedDeviationPreviewRow } from "./preview/DeviationsPreview";

interface StudyPipelineViewProps {
  studyId: string;
  pipelineState: UseStudyPipelineStateResult;
  backendStatuses: Record<string, StepStatus>;
  onStatusesChange: (statuses: Record<string, StepStatus>) => void;
  onRunFullPipeline: (extractor: Step1PdfExtractor) => Promise<void>;
  onReRunPipeline: (extractor: Step1PdfExtractor) => Promise<void>;
  onMapPdSpecToReview: () => Promise<void>;
  onEnrichPdSpecToReview: () => Promise<void>;
  onStudiesReload?: () => void;
  processingProgress: ProcessingSubProgressItem[];
  isProcessing: boolean;
  isPdSpecActionRunning: boolean;
  processingMessage: string;
  processingError: string;
  pdSpecActionMessage: string;
  pdSpecActionError: string;
  extractionLlmInstructions: string;
  onExtractionLlmInstructionsChange: (value: string) => void;
}

type PreviewTarget = "protocol" | "acrf" | "pd-spec" | null;

function resolveUploadSlot(pending: File | null, server: DocumentUploadState): DocumentUploadState {
  if (server.status === "uploading" || server.status === "uploaded" || server.status === "error") {
    return server;
  }
  if (pending) {
    return {
      status: "selected",
      originalFileName: pending.name,
      sizeBytes: pending.size
    };
  }
  return server;
}

function preprocessLine(status: PreprocessStatus, uploaded: boolean): string | undefined {
  if (!uploaded) {
    return undefined;
  }
  switch (status) {
    case "running":
      return "Preparing…";
    case "done":
      return "Ready";
    case "failed":
      return "Preparation failed";
    default:
      return "Uploaded";
  }
}

export function StudyPipelineView({
  studyId,
  pipelineState,
  backendStatuses,
  onStatusesChange,
  onRunFullPipeline,
  onReRunPipeline,
  onMapPdSpecToReview,
  onEnrichPdSpecToReview,
  onStudiesReload,
  processingProgress,
  isProcessing,
  isPdSpecActionRunning,
  processingMessage,
  processingError,
  pdSpecActionMessage,
  pdSpecActionError,
  extractionLlmInstructions,
  onExtractionLlmInstructionsChange
}: StudyPipelineViewProps): JSX.Element {
  const {
    pipeline,
    setUploadSlot,
    setPreprocess,
    refreshUploadStatus,
    setExtraction,
    refreshRunState,
    isLoadingUploadStatus,
    uploadStatusError
  } = pipelineState;

  const [extractorChoice, setExtractorChoice] = useState<Step1PdfExtractor>("both");
  const [pendingProtocolFile, setPendingProtocolFile] = useState<File | null>(null);
  const [pendingAcrfFile, setPendingAcrfFile] = useState<File | null>(null);
  const [pendingPdSpecFile, setPendingPdSpecFile] = useState<File | null>(null);
  const [previewTarget, setPreviewTarget] = useState<PreviewTarget>(null);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewMarkdown, setPreviewMarkdown] = useState("");
  const [previewTableRows, setPreviewTableRows] = useState<ExtendedDeviationPreviewRow[]>([]);
  const [previewSpreadsheetColumns, setPreviewSpreadsheetColumns] = useState<string[]>([]);
  const [previewSpreadsheetRows, setPreviewSpreadsheetRows] = useState<Array<Record<string, string>>>([]);
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [previewError, setPreviewError] = useState("");
  const [protocolPreviewReady, setProtocolPreviewReady] = useState(false);
  const [acrfPreviewReady, setAcrfPreviewReady] = useState(false);
  const preprocessPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const isBusy =
    isProcessing ||
    isPdSpecActionRunning ||
    pipeline.uploads.protocol.status === "uploading" ||
    pipeline.uploads.acrf.status === "uploading" ||
    pipeline.uploads.pdSpec.status === "uploading";

  useEffect(() => {
    if (isProcessing) {
      setExtraction({ status: "running", currentStage: "extract" });
    }
  }, [isProcessing, setExtraction]);

  useEffect(() => {
    const needsPoll =
      pipeline.preprocess.protocol === "running" || pipeline.preprocess.acrf === "running";
    if (!needsPoll || !studyId.trim()) {
      if (preprocessPollRef.current) {
        clearInterval(preprocessPollRef.current);
        preprocessPollRef.current = null;
      }
      return;
    }
    preprocessPollRef.current = setInterval(() => {
      void refreshUploadStatus(undefined, { silent: true });
      void refreshRunState();
    }, 3000);
    return () => {
      if (preprocessPollRef.current) {
        clearInterval(preprocessPollRef.current);
        preprocessPollRef.current = null;
      }
    };
  }, [
    pipeline.preprocess.protocol,
    pipeline.preprocess.acrf,
    refreshUploadStatus,
    refreshRunState,
    studyId
  ]);

  useEffect(() => {
    async function checkPreviews(): Promise<void> {
      if (!studyId.trim()) {
        setProtocolPreviewReady(false);
        setAcrfPreviewReady(false);
        return;
      }
      try {
        const preview = await fetchStep1Preview(studyId.trim());
        setProtocolPreviewReady(Boolean(preview.protocolExists && preview.protocolPreview?.trim()));
        setAcrfPreviewReady(Boolean(preview.acrfExists && preview.acrfPreview?.trim()));
      } catch {
        setProtocolPreviewReady(false);
        setAcrfPreviewReady(false);
      }
    }
    void checkPreviews();
  }, [studyId, isProcessing, pipeline.preprocess.protocol, pipeline.preprocess.acrf]);

  const triggerBackgroundPreprocess = useCallback(
    (slot: "protocol" | "acrf", options?: { afterUpload?: boolean }) => {
      const trimmed = studyId.trim();
      if (!trimmed) {
        return;
      }
      if (!options?.afterUpload) {
        if (slot === "protocol" && pipeline.preprocess.protocol === "done") {
          return;
        }
        if (slot === "acrf" && pipeline.preprocess.acrf === "done") {
          return;
        }
      }
      setPreprocess(slot, "running");
      const run = slot === "protocol" ? preprocessProtocol : preprocessAcrf;
      void run(trimmed)
        .then((result) => {
          onStatusesChange(result.stepStatuses);
          setPreprocess(slot, "done");
          void refreshUploadStatus(trimmed);
        })
        .catch(() => {
          setPreprocess(slot, "failed");
          void refreshUploadStatus(trimmed);
        });
    },
    [
      onStatusesChange,
      pipeline.preprocess.acrf,
      pipeline.preprocess.protocol,
      refreshUploadStatus,
      setPreprocess,
      studyId
    ]
  );

  const openMarkdownPreview = useCallback(
    async (target: "protocol" | "acrf"): Promise<void> => {
      const trimmed = studyId.trim();
      if (!trimmed) {
        return;
      }
      setPreviewTarget(target);
      setPreviewTitle(target === "protocol" ? "Protocol — extracted markdown" : "aCRF — extracted markdown");
      setPreviewMarkdown("");
      setPreviewTableRows([]);
      setPreviewSpreadsheetColumns([]);
      setPreviewSpreadsheetRows([]);
      setPreviewError("");
      setIsLoadingPreview(true);
      try {
        const preview = await fetchStep1Preview(trimmed, { full: true });
        onStatusesChange(preview.stepStatuses);
        setPreviewMarkdown(target === "protocol" ? preview.protocolPreview : preview.acrfPreview);
      } catch (loadError) {
        setPreviewError(loadError instanceof Error ? loadError.message : "Unable to load preview.");
      } finally {
        setIsLoadingPreview(false);
      }
    },
    [onStatusesChange, studyId]
  );

  const openPdSpecPreview = useCallback(async (): Promise<void> => {
    const trimmed = studyId.trim();
    if (!trimmed) {
      return;
    }
    setPreviewTarget("pd-spec");
    setPreviewTitle("PD Specifications workbook");
    setPreviewMarkdown("");
    setPreviewTableRows([]);
    setPreviewSpreadsheetColumns([]);
    setPreviewSpreadsheetRows([]);
    setPreviewError("");
    setIsLoadingPreview(true);
    try {
      const response = await fetchSpecificationsPreview(trimmed);
      const workbook = response.sources.find((source) => source.key === "pd_spec_workbook");
      setPreviewTableRows([]);
      setPreviewSpreadsheetColumns(workbook?.columns ?? []);
      setPreviewSpreadsheetRows(
        workbook?.columns?.length ? (workbook.rows as Array<Record<string, string>>) : []
      );
      if (!workbook?.rows.length) {
        setPreviewError("No PD specification rows found. Upload a workbook first.");
      }
    } catch (loadError) {
      setPreviewError(loadError instanceof Error ? loadError.message : "Unable to load PD spec preview.");
    } finally {
      setIsLoadingPreview(false);
    }
  }, [studyId]);

  function closePreview(): void {
    setPreviewTarget(null);
    setPreviewError("");
  }

  async function handleUploadSlot(slot: "protocol" | "acrf", fileOverride?: File): Promise<void> {
    const trimmedStudyId = studyId.trim();
    const file = fileOverride ?? (slot === "protocol" ? pendingProtocolFile : pendingAcrfFile);
    if (!file || !trimmedStudyId) {
      return;
    }
    if (slot === "protocol") {
      setPendingProtocolFile(file);
    } else {
      setPendingAcrfFile(file);
    }
    setUploadSlot(slot, {
      status: "uploading",
      originalFileName: file.name,
      sizeBytes: file.size,
      error: undefined
    });
    try {
      const response = await uploadStep1File(trimmedStudyId, slot, file);
      onStatusesChange(response.stepStatuses);
      await refreshUploadStatus(trimmedStudyId);
      onStudiesReload?.();
      if (slot === "protocol") {
        setPendingProtocolFile(null);
      } else {
        setPendingAcrfFile(null);
      }
      triggerBackgroundPreprocess(slot, { afterUpload: true });
    } catch (uploadError) {
      setUploadSlot(slot, {
        status: "error",
        originalFileName: file.name,
        sizeBytes: file.size,
        error: uploadError instanceof Error ? uploadError.message : "Upload failed."
      });
    }
  }

  async function handleUploadPdSpec(fileOverride?: File): Promise<void> {
    const trimmedStudyId = studyId.trim();
    const file = fileOverride ?? pendingPdSpecFile;
    if (!file || !trimmedStudyId) {
      return;
    }
    setPendingPdSpecFile(file);
    setUploadSlot("pdSpec", {
      status: "uploading",
      originalFileName: file.name,
      sizeBytes: file.size,
      error: undefined
    });
    try {
      const result = await uploadPdSpecWorkbook(trimmedStudyId, file);
      onStatusesChange(result.stepStatuses);
      await refreshUploadStatus(trimmedStudyId);
      onStudiesReload?.();
      setPendingPdSpecFile(null);
    } catch (uploadError) {
      setUploadSlot("pdSpec", {
        status: "error",
        originalFileName: file.name,
        sizeBytes: file.size,
        error: uploadError instanceof Error ? uploadError.message : "Upload failed."
      });
    }
  }

  async function handleRunFullPipelineClick(forceReRun = false): Promise<void> {
    if (!studyId.trim() || !pipeline.bothUploaded) {
      return;
    }
    setExtraction({
      status: "running",
      currentStage: "extract",
      currentSubStepId: "extract-inputs",
      message: forceReRun ? "Re-running extraction pipeline…" : "Starting extraction pipeline…",
      error: "",
      logs: []
    });
    try {
      const run = forceReRun ? onReRunPipeline : onRunFullPipeline;
      await run(extractorChoice);
      setExtraction({ status: "done", currentStage: "complete", message: "Processing completed." });
      await refreshRunState();
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : "Processing failed.";
      setExtraction({ status: "failed", error: message });
    }
  }

  const protocolSlot = resolveUploadSlot(pendingProtocolFile, pipeline.uploads.protocol);
  const acrfSlot = resolveUploadSlot(pendingAcrfFile, pipeline.uploads.acrf);
  const pdSpecSlot = resolveUploadSlot(pendingPdSpecFile, pipeline.uploads.pdSpec);
  const showPipelineProgress =
    isProcessing || pipeline.extraction.status === "running" || pipeline.extraction.status === "failed";

  return (
    <section className="workflow-panel study-pipeline-view" aria-label="Study pipeline setup">
      <div className="study-pipeline-stage">
        <h3 className="study-pipeline-stage-title">Upload source documents</h3>
        <p className="step7-muted">
          Upload protocol, annotated aCRF, and optionally PD Specifications. PDFs upload automatically; each document
          is prepared in the background after upload.
        </p>

        {isLoadingUploadStatus ? (
          <div className="upload-blob-status-banner" role="status" aria-live="polite">
            <span className="upload-spinner" aria-hidden="true" />
            <span>Checking blob storage…</span>
          </div>
        ) : null}
        {uploadStatusError ? <p className="step1-error">{uploadStatusError}</p> : null}

        <div className="upload-cards-grid upload-cards-grid-three">
          <DocumentUploadCard
            label="Protocol"
            inputId="pipeline-protocol-file"
            slot={protocolSlot}
            disabled={isBusy || isLoadingUploadStatus || !studyId.trim()}
            onFileSelected={(file) => void handleUploadSlot("protocol", file)}
            onRetry={() => {
              const file = pendingProtocolFile;
              if (file) {
                void handleUploadSlot("protocol", file);
              }
            }}
            onPreview={
              protocolSlot.status === "uploaded" ? () => void openMarkdownPreview("protocol") : undefined
            }
            previewDisabled={!protocolPreviewReady}
            previewLabel={protocolPreviewReady ? "Preview markdown" : "Preview after preparation"}
            preprocessLine={preprocessLine(pipeline.preprocess.protocol, protocolSlot.status === "uploaded")}
          />
          <DocumentUploadCard
            label="Annotated CRF (aCRF)"
            inputId="pipeline-acrf-file"
            slot={acrfSlot}
            disabled={isBusy || isLoadingUploadStatus || !studyId.trim()}
            onFileSelected={(file) => void handleUploadSlot("acrf", file)}
            onRetry={() => {
              const file = pendingAcrfFile;
              if (file) {
                void handleUploadSlot("acrf", file);
              }
            }}
            onPreview={acrfSlot.status === "uploaded" ? () => void openMarkdownPreview("acrf") : undefined}
            previewDisabled={!acrfPreviewReady}
            previewLabel={acrfPreviewReady ? "Preview markdown" : "Preview after preparation"}
            preprocessLine={preprocessLine(pipeline.preprocess.acrf, acrfSlot.status === "uploaded")}
          />
          <DocumentUploadCard
            label="PD Specification"
            inputId="pipeline-pd-spec-file"
            slot={pdSpecSlot}
            disabled={isBusy || isLoadingUploadStatus || !studyId.trim()}
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            chooseLabel={pdSpecSlot.status === "uploaded" ? "Replace workbook" : "Choose workbook (.xlsx)"}
            onFileSelected={(file) => void handleUploadPdSpec(file)}
            onRetry={() => {
              const file = pendingPdSpecFile;
              if (file) {
                void handleUploadPdSpec(file);
              }
            }}
            onPreview={pdSpecSlot.status === "uploaded" ? () => void openPdSpecPreview() : undefined}
            previewLabel="Preview workbook"
            preprocessLine={
              pdSpecSlot.status === "uploaded" ? "Uploaded" : undefined
            }
          />
        </div>

        {!studyId.trim() ? (
          <p className="step7-muted upload-gate-hint">Select or create a study before uploading documents.</p>
        ) : null}
      </div>

      <div className="study-pipeline-stage">
        <PipelineActionTiles
          bothUploaded={pipeline.bothUploaded}
          pdSpecUploaded={pdSpecSlot.status === "uploaded"}
          uploadStatusReady={!isLoadingUploadStatus && Boolean(studyId.trim())}
          isBusy={isBusy}
          isProcessing={isProcessing}
          hideStatusMessages={showPipelineProgress}
          backendStatuses={backendStatuses}
          extractorChoice={extractorChoice}
          extractionLlmInstructions={extractionLlmInstructions}
          onExtractorChange={setExtractorChoice}
          onLlmInstructionsChange={onExtractionLlmInstructionsChange}
          onRunFullPipeline={() => void handleRunFullPipelineClick(false)}
          onReRunPipeline={() => void handleRunFullPipelineClick(true)}
          onMapPdSpecToReview={() => void onMapPdSpecToReview()}
          onEnrichPdSpecToReview={() => void onEnrichPdSpecToReview()}
          pipelineMessage={pdSpecActionMessage || processingMessage || pipeline.extraction.message}
          pipelineError={pdSpecActionError || processingError || pipeline.extraction.error}
        />

        {showPipelineProgress ? (
          <ExtractionStatusPanel
            extraction={pipeline.extraction}
            processingProgress={processingProgress}
            isProcessing={isProcessing}
            processingMessage={processingMessage}
            processingError={processingError}
            studyId={studyId}
            pollRunStateDuringExtract={isProcessing}
            simplified
            onRunStatePolled={(runState) => {
              setExtraction({
                logs: runState.logs,
                message: runState.message,
                currentSubStepId: runState.currentSubStepId,
                currentStage: runState.currentStage
              });
            }}
          />
        ) : null}
      </div>

      <DocumentPreviewModal
        open={previewTarget !== null}
        title={previewTitle}
        kind={previewTarget === "pd-spec" ? "spreadsheet" : "markdown"}
        markdownContent={previewMarkdown}
        tableRows={previewTableRows}
        spreadsheetColumns={previewSpreadsheetColumns}
        spreadsheetRows={previewSpreadsheetRows}
        isLoading={isLoadingPreview}
        error={previewError}
        onClose={closePreview}
      />
    </section>
  );
}
