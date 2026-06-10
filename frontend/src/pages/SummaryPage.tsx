import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Section } from "../components/layout/Section";
import { useStudyContext } from "../hooks/useStudyContext";
import { useStudySettings } from "../hooks/useStudySettings";
import { useStudyPipelineState } from "../hooks/useStudyPipelineState";
import type { Step1DocumentExtractor } from "../services/stepApi";
import { workflowLabel } from "../types/workflow";

function documentExtractorLabel(value: Step1DocumentExtractor): string {
  return value === "opendataloader" ? "OpenDataLoader" : "Document Intelligence";
}

function formatBytes(size: number): string {
  if (!size) {
    return "—";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function SummaryPage(): JSX.Element {
  const { studyId, summary, refresh, pipelineRunner } = useStudyContext();
  const { settings } = useStudySettings(studyId);
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [isStarting, setIsStarting] = useState(false);
  const pipelineState = useStudyPipelineState(studyId, () => {
    void refresh();
  });

  const upload = summary?.uploadStatus;
  const preprocessRunning =
    pipelineState.pipeline.preprocess.protocol === "running" ||
    pipelineState.pipeline.preprocess.acrf === "running";

  async function handleStartExtraction(): Promise<void> {
    const trimmed = studyId.trim();
    const workflow = summary?.workflow;
    if (!trimmed || !workflow || isStarting || preprocessRunning) {
      return;
    }
    setIsStarting(true);
    setError("");
    pipelineRunner.clearError();
    try {
      navigate(`/projects/${encodeURIComponent(trimmed)}/review`);
      void pipelineRunner.startPipeline().catch((startError) => {
        setError(startError instanceof Error ? startError.message : "Unable to start extraction.");
      });
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "Unable to start extraction.");
    } finally {
      setIsStarting(false);
    }
  }

  const displayError = error || pipelineRunner.lastError;

  return (
    <Section className="workflow-panel">
      <h2 className="page-title">Summary</h2>
      <p className="page-lead">Review configuration before starting extraction.</p>

      <dl className="summary-list">
        <div>
          <dt>Workflow</dt>
          <dd>{workflowLabel(summary?.workflow)}</dd>
        </div>
        {summary?.workflow !== "map" ? (
          <>
            <div>
              <dt>Protocol OCR</dt>
              <dd>{documentExtractorLabel(settings.protocolExtractor)}</dd>
            </div>
            <div>
              <dt>aCRF OCR</dt>
              <dd>{documentExtractorLabel(settings.acrfExtractor)}</dd>
            </div>
            <div>
              <dt>Extraction LLM</dt>
              <dd>{settings.extractionDeployment || "Not set"}</dd>
            </div>
            <div>
              <dt>aCRF summary LLM</dt>
              <dd>{settings.acrfSummaryDeployment || "Not set"}</dd>
            </div>
          </>
        ) : null}
        {upload?.protocol.uploaded ? (
          <div>
            <dt>Protocol</dt>
            <dd>
              {upload.protocol.fileName} ({formatBytes(upload.protocol.size)})
            </dd>
          </div>
        ) : null}
        {upload?.acrf.uploaded ? (
          <div>
            <dt>aCRF</dt>
            <dd>
              {upload.acrf.fileName} ({formatBytes(upload.acrf.size)})
            </dd>
          </div>
        ) : null}
        {upload?.pdSpec.uploaded ? (
          <div>
            <dt>PD Spec</dt>
            <dd>
              {upload.pdSpec.fileName} ({formatBytes(upload.pdSpec.size)})
            </dd>
          </div>
        ) : null}
      </dl>

      {displayError ? <p className="step1-error">{displayError}</p> : null}
      {preprocessRunning ? (
        <p className="step7-muted">Waiting for upload preprocess to finish before starting extraction…</p>
      ) : null}

      <button
        className="button button-primary"
        type="button"
        disabled={isStarting || !summary?.workflow || preprocessRunning || pipelineRunner.isRunning}
        onClick={() => void handleStartExtraction()}
      >
        {isStarting || pipelineRunner.isRunning ? "Starting…" : "Start extraction"}
      </button>
    </Section>
  );
}
