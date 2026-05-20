import { useCallback, useEffect, useMemo, useState } from "react";
import type { UseStudyPipelineStateResult } from "../../hooks/useStudyPipelineState";
import { isProcessingDone } from "../../utils/processingStatus";
import type { DocumentUploadState } from "../../hooks/useStudyPipelineState";
import {
  fetchStep1Preview,
  uploadStep1File,
  type Step1PdfExtractor,
  type StepStatus
} from "../../services/stepApi";
import { DocumentUploadCard } from "./DocumentUploadCard";
import { ExtractionStatusPanel } from "./ExtractionStatusPanel";
import { MarkdownPreview } from "./MarkdownPreview";
import type { ProcessingSubProgressItem } from "./ProcessingPanel";
import { PipelineStepper, type PipelineStage, type PipelineStageId } from "./PipelineStepper";
import { StudySelector } from "../ui/StudySelector";
import type { StudyOption } from "../../services/stepApi";

interface StudyPipelineViewProps {
  studyId: string;
  backendStatuses: Record<string, StepStatus>;
  pipelineState: UseStudyPipelineStateResult;
  onStatusesChange: (statuses: Record<string, StepStatus>) => void;
  onStudyChange: (studyId: string) => void;
  onNewStudy?: () => void;
  studies: StudyOption[];
  isLoadingStudies?: boolean;
  studyListError?: string;
  onReloadStudies?: () => void;
  onRunProcessing: (extractor: Step1PdfExtractor) => Promise<void>;
  onRunToDmReview: () => Promise<void>;
  onNavigateToStep: (stepId: string) => void;
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

export function StudyPipelineView({
  studyId,
  backendStatuses,
  pipelineState,
  onStatusesChange,
  onStudyChange,
  onNewStudy,
  studies,
  isLoadingStudies = false,
  studyListError = "",
  onReloadStudies,
  onRunProcessing,
  onRunToDmReview,
  onNavigateToStep,
  processingProgress,
  isProcessing,
  processingMessage,
  processingError,
  isAutoRunning,
  autoRunMessage,
  autoRunError
}: StudyPipelineViewProps): JSX.Element {
  const {
    pipeline,
    setUploadSlot,
    refreshUploadStatus,
    applyUploadStatus,
    setExtraction,
    refreshRunState,
    isLoadingUploadStatus,
    uploadStatusError
  } = pipelineState;

  const [extractorChoice, setExtractorChoice] = useState<Step1PdfExtractor>("both");
  const [protocolPreview, setProtocolPreview] = useState("");
  const [acrfPreview, setAcrfPreview] = useState("");
  const [previewProtocolFileName, setPreviewProtocolFileName] = useState("");
  const [previewAcrfFileName, setPreviewAcrfFileName] = useState("");
  const [isLoadingPreview, setIsLoadingPreview] = useState(false);
  const [pendingProtocolFile, setPendingProtocolFile] = useState<File | null>(null);
  const [pendingAcrfFile, setPendingAcrfFile] = useState<File | null>(null);

  const processingDone = isProcessingDone(backendStatuses);
  const deviationsDone = backendStatuses["extract-deviations"] === "done";
  const reviewDone = backendStatuses["review-and-finalize"] === "done";

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
      setPreviewProtocolFileName(preview.protocolFileName ?? "");
      setPreviewAcrfFileName(preview.acrfFileName ?? "");
    } catch {
      // best-effort
    } finally {
      setIsLoadingPreview(false);
    }
  }, [onStatusesChange, studyId]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview, processingDone]);

  useEffect(() => {
    if (isProcessing) {
      setExtraction({ status: "running", currentStage: "extract" });
    }
  }, [isProcessing, setExtraction]);

  useEffect(() => {
    if (!isProcessing && processingDone) {
      void refreshRunState();
    }
  }, [isProcessing, processingDone, refreshRunState]);

  const stages = useMemo((): PipelineStage[] => {
    const uploadStatus: PipelineStage["status"] = pipeline.bothUploaded
      ? "done"
      : pipeline.uploads.protocol.status === "uploading" || pipeline.uploads.acrf.status === "uploading"
        ? "in_progress"
        : "ready";

    let extractStatus: PipelineStage["status"] = "locked";
    if (pipeline.bothUploaded) {
      if (isProcessing) {
        extractStatus = "in_progress";
      } else if (processingDone) {
        extractStatus = "done";
      } else if (pipeline.extraction.status === "failed" || processingError) {
        extractStatus = "failed";
      } else {
        extractStatus = "ready";
      }
    }

    let deviationsStatus: PipelineStage["status"] = "locked";
    if (processingDone) {
      deviationsStatus = isAutoRunning ? "in_progress" : deviationsDone ? "done" : "ready";
    }

    let reviewStatus: PipelineStage["status"] = "locked";
    if (deviationsDone) {
      reviewStatus = reviewDone ? "done" : "ready";
    }

    return [
      {
        id: "upload",
        title: "Upload source documents",
        description: "Protocol PDF and annotated aCRF",
        status: uploadStatus
      },
      {
        id: "extract",
        title: "Extraction pipeline",
        description: "Extract, index, and prepare structured inputs",
        status: extractStatus
      },
      {
        id: "deviations",
        title: "Generate deviations",
        description: "Extract rules and deviation candidates",
        status: deviationsStatus
      },
      {
        id: "review",
        title: "Review deviations",
        description: "Accept, refine, and finalize",
        status: reviewStatus
      }
    ];
  }, [
    pipeline,
    isProcessing,
    processingDone,
    processingError,
    isAutoRunning,
    deviationsDone,
    reviewDone
  ]);

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
      const status = await refreshUploadStatus(trimmedStudyId);
      if (!status) {
        setUploadSlot(slot, {
          status: "uploaded",
          originalFileName: file.name,
          sizeBytes: file.size,
          blobPath: slot === "protocol" ? response.protocolBlob : response.acrfBlob,
          error: undefined
        });
        applyUploadStatus({
          studyId: trimmedStudyId,
          protocol: {
            uploaded: slot === "protocol" || response.protocolSize > 0,
            fileName: response.protocolFileName ?? "protocol.pdf",
            size: response.protocolSize,
            blob: response.protocolBlob
          },
          acrf: {
            uploaded: slot === "acrf" || response.acrfSize > 0,
            fileName: response.acrfFileName ?? "acrf.pdf",
            size: response.acrfSize,
            blob: response.acrfBlob
          },
          bothUploaded: response.bothUploaded ?? false,
          stepStatuses: response.stepStatuses
        });
      }
      if (slot === "protocol") {
        setPendingProtocolFile(null);
      } else {
        setPendingAcrfFile(null);
      }
    } catch (uploadError) {
      setUploadSlot(slot, {
        status: "error",
        originalFileName: file.name,
        sizeBytes: file.size,
        error: uploadError instanceof Error ? uploadError.message : "Upload failed."
      });
    }
  }

  async function handleRunProcessing(): Promise<void> {
    if (!studyId.trim() || !pipeline.bothUploaded) {
      return;
    }
    setExtraction({
      status: "running",
      currentStage: "extract",
      currentSubStepId: "extract-inputs",
      message: "Starting extraction pipeline…",
      error: "",
      logs: []
    });
    try {
      await onRunProcessing(extractorChoice);
      setExtraction({ status: "done", currentStage: "complete", message: "Processing completed." });
      await loadPreview();
      await refreshRunState();
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : "Processing failed.";
      setExtraction({
        status: "failed",
        error: message
      });
    }
  }

  function handleStepperSelect(stageId: PipelineStageId): void {
    if (stageId === "review") {
      onNavigateToStep("review-and-finalize");
    } else if (stageId === "deviations") {
      onNavigateToStep("extract-deviations");
    } else if (stageId === "extract" || stageId === "upload") {
      onNavigateToStep("processing");
    }
  }

  const canRunExtraction = Boolean(studyId.trim() && pipeline.bothUploaded && !isProcessing && !isUploadingAny());

  function isUploadingAny(): boolean {
    return pipeline.uploads.protocol.status === "uploading" || pipeline.uploads.acrf.status === "uploading";
  }

  const protocolSlot = resolveUploadSlot(pendingProtocolFile, pipeline.uploads.protocol);
  const acrfSlot = resolveUploadSlot(pendingAcrfFile, pipeline.uploads.acrf);
  const uploadCount = Number(pipeline.uploads.protocol.status === "uploaded") + Number(pipeline.uploads.acrf.status === "uploaded");

  return (
    <section className="workflow-panel study-pipeline-view" aria-label="Study pipeline setup">
      <div className="study-pipeline-project-panel">
        <StudySelector
          value={studyId}
          onChange={onStudyChange}
          onNewStudy={onNewStudy}
          studies={studies}
          isLoading={isLoadingStudies}
          error={studyListError}
          onReload={onReloadStudies}
          showBlobPickerFirst
          blobPickerId="step1-blob-project-picker"
        />
      </div>

      <PipelineStepper stages={stages} onSelect={handleStepperSelect} />

      <div className="study-pipeline-stage">
        <h3 className="study-pipeline-stage-title">Step 1: Upload source documents</h3>
        <p className="step7-muted">Upload the protocol and annotated aCRF. Files upload automatically when selected.</p>

        {isLoadingUploadStatus ? (
          <div className="upload-blob-status-banner" role="status" aria-live="polite">
            <span className="upload-spinner" aria-hidden="true" />
            <span>Checking blob storage for uploaded documents…</span>
          </div>
        ) : null}
        {uploadStatusError ? <p className="step1-error">{uploadStatusError}</p> : null}

        {!isLoadingUploadStatus && studyId.trim() ? (
          <div className="upload-blob-summary" aria-label="Blob upload summary">
            <span className="upload-blob-summary-label">
              Blob status for <strong>{studyId.trim()}</strong>: {uploadCount}/2 documents
            </span>
            <ul className="upload-blob-summary-list">
              <li className={pipeline.uploads.protocol.status === "uploaded" ? "upload-blob-item-done" : ""}>
                <span className="upload-blob-item-name">Protocol</span>
                <span className="upload-blob-item-file">
                  {pipeline.uploads.protocol.status === "uploaded"
                    ? pipeline.uploads.protocol.originalFileName
                    : "Not uploaded"}
                </span>
                {pipeline.uploads.protocol.blobPath ? (
                  <span className="upload-blob-item-path">{pipeline.uploads.protocol.blobPath}</span>
                ) : null}
              </li>
              <li className={pipeline.uploads.acrf.status === "uploaded" ? "upload-blob-item-done" : ""}>
                <span className="upload-blob-item-name">aCRF</span>
                <span className="upload-blob-item-file">
                  {pipeline.uploads.acrf.status === "uploaded"
                    ? pipeline.uploads.acrf.originalFileName
                    : "Not uploaded"}
                </span>
                {pipeline.uploads.acrf.blobPath ? (
                  <span className="upload-blob-item-path">{pipeline.uploads.acrf.blobPath}</span>
                ) : null}
              </li>
            </ul>
          </div>
        ) : null}

        <div className="upload-cards-grid">
          <DocumentUploadCard
            label="Protocol"
            inputId="pipeline-protocol-file"
            slot={protocolSlot}
            disabled={isProcessing || isLoadingUploadStatus || !studyId.trim()}
            onFileSelected={(file) => void handleUploadSlot("protocol", file)}
            onRetry={() => {
              const file = pendingProtocolFile;
              if (file) {
                void handleUploadSlot("protocol", file);
              }
            }}
          />
          <DocumentUploadCard
            label="Annotated CRF (aCRF)"
            inputId="pipeline-acrf-file"
            slot={acrfSlot}
            disabled={isProcessing || isLoadingUploadStatus || !studyId.trim()}
            onFileSelected={(file) => void handleUploadSlot("acrf", file)}
            onRetry={() => {
              const file = pendingAcrfFile;
              if (file) {
                void handleUploadSlot("acrf", file);
              }
            }}
          />
        </div>
        {!studyId.trim() ? (
          <p className="step7-muted upload-gate-hint">Enter a study ID before uploading documents.</p>
        ) : !pipeline.bothUploaded ? (
          <p className="step7-muted upload-gate-hint">Upload both documents to enable the extraction pipeline.</p>
        ) : (
          <p className="step1-status">Both documents are loaded in blob storage. You can run extraction.</p>
        )}
      </div>

      <div className="study-pipeline-stage">
        <h3 className="study-pipeline-stage-title">Step 2: Run extraction pipeline</h3>
        <fieldset className="step1-extractor-fieldset" disabled={!pipeline.bothUploaded || isProcessing}>
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
        </fieldset>

        <div className="step1-actions">
          <button
            className="button button-primary"
            type="button"
            onClick={() => void handleRunProcessing()}
            disabled={!canRunExtraction}
            title={!pipeline.bothUploaded ? "Upload protocol and aCRF first" : undefined}
          >
            {isProcessing ? "Running extraction pipeline…" : processingDone ? "Re-run extraction pipeline" : "Run extraction pipeline"}
          </button>
          <button
            className="button button-optional"
            type="button"
            onClick={() => void onRunToDmReview()}
            disabled={!processingDone || isProcessing || isAutoRunning || isUploadingAny()}
          >
            {isAutoRunning ? "Running pipeline…" : "Run to review"}
          </button>
        </div>

        <ExtractionStatusPanel
          extraction={pipeline.extraction}
          processingProgress={processingProgress}
          isProcessing={isProcessing}
          processingMessage={processingMessage}
          processingError={processingError}
        />
      </div>

      <div className="study-pipeline-stage study-pipeline-stage-compact">
        <h3 className="study-pipeline-stage-title">Steps 3–4</h3>
        <div className="step1-actions">
          <button
            className="button button-secondary"
            type="button"
            disabled={!processingDone}
            onClick={() => onNavigateToStep("extract-deviations")}
          >
            Generate deviations
          </button>
          <button
            className="button button-secondary"
            type="button"
            disabled={!deviationsDone}
            onClick={() => onNavigateToStep("review-and-finalize")}
          >
            Review deviations
          </button>
        </div>
        {autoRunMessage ? <p className="step1-status">{autoRunMessage}</p> : null}
        {autoRunError ? <p className="step1-error">{autoRunError}</p> : null}
      </div>

      {isLoadingPreview ? <p className="step1-status">Loading preview…</p> : null}
      {protocolPreview || acrfPreview || processingDone ? (
        <div className="step1-preview-grid">
          <article className="preview-item">
            <p className="preview-title">
              Protocol
              {(pipeline.uploads.protocol.originalFileName || previewProtocolFileName)
                ? ` — ${pipeline.uploads.protocol.originalFileName || previewProtocolFileName}`
                : ""}
            </p>
            <MarkdownPreview content={protocolPreview} />
          </article>
          <article className="preview-item">
            <p className="preview-title">
              aCRF
              {(pipeline.uploads.acrf.originalFileName || previewAcrfFileName)
                ? ` — ${pipeline.uploads.acrf.originalFileName || previewAcrfFileName}`
                : ""}
            </p>
            <MarkdownPreview content={acrfPreview} />
          </article>
        </div>
      ) : null}
    </section>
  );
}
