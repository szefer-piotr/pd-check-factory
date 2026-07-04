import { useCallback, useEffect, useMemo, useState } from "react";
import { StudyPipelineView } from "../../components/workflow/StudyPipelineView";
import { LlmDeploymentSelect } from "../../components/ui/LlmDeploymentSelect";
import { WORKFLOW_LABELS, type WorkflowChoice } from "../../data/wizardSteps";
import type { UseStudyPipelineStateResult } from "../../hooks/useStudyPipelineState";
import type { StudySettings } from "../../hooks/useStudySettings";
import {
  activateStudyRun,
  applyStudyRun,
  fetchStudyRuns,
  type OpenAiDeploymentOption,
  type Step1PdfExtractor,
  type StepStatus,
  type StudyRunEntry,
  type StudySummary
} from "../../services/stepApi";

const EXTRACTOR_OPTIONS: Array<{ value: Step1PdfExtractor; label: string }> = [
  { value: "both", label: "Auto (recommended)" },
  { value: "opendataloader", label: "OpenDataLoader" },
  { value: "document_intelligence", label: "Document Intelligence (Azure)" }
];

const EXTRACTOR_LABELS: Record<Step1PdfExtractor, string> = {
  both: "Auto (recommended)",
  opendataloader: "OpenDataLoader",
  document_intelligence: "Document Intelligence (Azure)"
};

function formatBytes(size: number): string {
  if (!size) {
    return "—";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  return `${(size / 1024).toFixed(1)} KB`;
}

function runLabel(run: StudyRunEntry): string {
  const models = [run.settings.extractionDeployment, run.settings.acrfSummaryDeployment]
    .filter(Boolean)
    .join(" / ");
  const files = [run.uploads.protocolFileName, run.uploads.acrfFileName].filter(Boolean).join(" + ");
  const date = run.updatedAt ? new Date(run.updatedAt).toLocaleString() : "";
  return `${files || run.runId}${models ? ` — ${models}` : ""}${date ? ` (${date})` : ""}`;
}

function settingsFromRun(settings: StudyRunEntry["settings"]): StudySettings {
  return {
    extractorChoice: settings.extractorChoice,
    extractionDeployment: settings.extractionDeployment,
    acrfSummaryDeployment: settings.acrfSummaryDeployment,
    extractionLlmInstructions: settings.extractionLlmInstructions,
    chatDeployment: ""
  };
}

interface SetupPageProps {
  studyId: string;
  workflow: WorkflowChoice | null;
  pipelineState: UseStudyPipelineStateResult;
  backendStatuses: Record<string, StepStatus>;
  onStatusesChange: (statuses: Record<string, StepStatus>) => void;
  onStudiesReload?: () => void;
  draftSettings: StudySettings;
  appliedSettings: StudySettings | null;
  onDraftSettingsChange: (patch: Partial<StudySettings>) => void;
  onApplySettings: (settings: StudySettings) => void;
  onLoadAppliedSettings: (settings: StudySettings) => void;
  llmDeployments: OpenAiDeploymentOption[];
  deploymentsLoading: boolean;
  summary: StudySummary | null;
  isSummaryLoading: boolean;
  onApplyComplete?: () => void;
}

export function SetupPage({
  studyId,
  workflow,
  pipelineState,
  backendStatuses,
  onStatusesChange,
  onStudiesReload,
  draftSettings,
  appliedSettings,
  onDraftSettingsChange,
  onApplySettings,
  onLoadAppliedSettings,
  llmDeployments,
  deploymentsLoading,
  summary,
  isSummaryLoading,
  onApplyComplete
}: SetupPageProps): JSX.Element {
  const showLlmSettings = workflow === "extract" || workflow === "enrich";
  const showPdSpec = workflow === "map" || workflow === "enrich";
  const [runs, setRuns] = useState<StudyRunEntry[]>([]);
  const [activeRunId, setActiveRunId] = useState("");
  const [runsLoading, setRunsLoading] = useState(false);
  const [applyMessage, setApplyMessage] = useState("");
  const [applyError, setApplyError] = useState("");
  const [isApplying, setIsApplying] = useState(false);

  const loadRuns = useCallback(async (): Promise<void> => {
    const trimmed = studyId.trim();
    if (!trimmed) {
      setRuns([]);
      setActiveRunId("");
      return;
    }
    setRunsLoading(true);
    try {
      const response = await fetchStudyRuns(trimmed);
      setRuns(response.runs);
      setActiveRunId(response.activeRunId);
    } catch {
      setRuns([]);
    } finally {
      setRunsLoading(false);
    }
  }, [studyId]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  const displaySettings = appliedSettings ?? draftSettings;

  async function handleApply(): Promise<void> {
    const trimmed = studyId.trim();
    if (!trimmed || !workflow || !summary) {
      return;
    }
    setIsApplying(true);
    setApplyError("");
    setApplyMessage("");
    try {
      const response = await applyStudyRun(trimmed, {
        workflow,
        uploads: {
          protocolFileName: summary.uploads.protocol.fileName || "",
          acrfFileName: summary.uploads.acrf.fileName || "",
          pdSpecFileName: summary.uploads.pdSpec.uploaded ? summary.uploads.pdSpec.fileName || "" : null
        },
        settings: {
          extractorChoice: draftSettings.extractorChoice,
          extractionDeployment: draftSettings.extractionDeployment,
          acrfSummaryDeployment: draftSettings.acrfSummaryDeployment,
          extractionLlmInstructions: draftSettings.extractionLlmInstructions
        }
      });
      const nextSettings = settingsFromRun(response.settings);
      onApplySettings(nextSettings);
      setRuns(response.runs);
      setActiveRunId(response.activeRunId);
      setApplyMessage(response.created ? "Run configuration saved." : "Existing run configuration activated.");
      onApplyComplete?.();
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Apply failed.");
    } finally {
      setIsApplying(false);
    }
  }

  async function handleRunSelect(runId: string): Promise<void> {
    const trimmed = studyId.trim();
    if (!trimmed || !runId) {
      return;
    }
    setApplyError("");
    try {
      const response = await activateStudyRun(trimmed, runId);
      const nextSettings = settingsFromRun(response.settings);
      onLoadAppliedSettings(nextSettings);
      setActiveRunId(response.activeRunId);
      setApplyMessage("Run configuration loaded.");
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Failed to switch run.");
    }
  }

  const runOptions = useMemo(
    () =>
      runs.map((run) => ({
        id: run.runId,
        label: runLabel(run)
      })),
    [runs]
  );

  return (
    <section className="wizard-setup" aria-label="Setup">
      <h2>Setup</h2>
      <p className="step7-muted">Configure options, apply your run settings, and upload source documents.</p>

      {runOptions.length > 0 ? (
        <label className="wizard-field wizard-setup-run-select">
          <span>Saved run configurations</span>
          <select
            value={activeRunId}
            disabled={runsLoading}
            onChange={(event) => void handleRunSelect(event.target.value)}
          >
            {runOptions.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      {showLlmSettings ? (
        <div className="wizard-setup-settings">
          <h3>LLM deployments</h3>
          <div className="settings-drawer-fields">
            <LlmDeploymentSelect
              id="setup-extraction-llm"
              label="Extraction model"
              value={draftSettings.extractionDeployment}
              deployments={llmDeployments}
              onChange={(value) => onDraftSettingsChange({ extractionDeployment: value })}
              isLoading={deploymentsLoading}
            />
            <LlmDeploymentSelect
              id="setup-acrf-summary-llm"
              label="aCRF summary model"
              value={draftSettings.acrfSummaryDeployment}
              deployments={llmDeployments}
              onChange={(value) => onDraftSettingsChange({ acrfSummaryDeployment: value })}
              isLoading={deploymentsLoading}
            />
          </div>
          {workflow === "extract" ? (
            <label className="wizard-field">
              <span>OCR method</span>
              <select
                value={draftSettings.extractorChoice}
                onChange={(event) =>
                  onDraftSettingsChange({ extractorChoice: event.target.value as Step1PdfExtractor })
                }
              >
                {EXTRACTOR_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      <div className="wizard-setup-apply-row">
        <button
          className="button button-primary"
          type="button"
          onClick={() => void handleApply()}
          disabled={isApplying || !workflow || !summary}
        >
          {isApplying ? "Applying…" : "Apply"}
        </button>
        {applyMessage ? <p className="step1-status">{applyMessage}</p> : null}
        {applyError ? <p className="step1-error">{applyError}</p> : null}
      </div>

      <StudyPipelineView
        studyId={studyId}
        pipelineState={pipelineState}
        backendStatuses={backendStatuses}
        onStatusesChange={onStatusesChange}
        onRunFullPipeline={async () => {}}
        onReRunPipeline={async () => {}}
        onMapPdSpecToReview={async () => {}}
        onEnrichPdSpecToReview={async () => {}}
        onStudiesReload={onStudiesReload}
        isProcessing={false}
        isPdSpecActionRunning={false}
        processingMessage=""
        processingError=""
        pdSpecActionMessage=""
        pdSpecActionError=""
        extractorChoice={draftSettings.extractorChoice}
        uploadsOnly
        showPdSpecSlot={showPdSpec}
      />

      <section className="wizard-summary" aria-label="Configuration summary">
        <h3>Configuration summary</h3>
        {isSummaryLoading && !summary ? <p className="step7-muted">Loading…</p> : null}
        <dl className="wizard-summary-list">
          <div>
            <dt>Study ID</dt>
            <dd>{studyId}</dd>
          </div>
          <div>
            <dt>Workflow</dt>
            <dd>{workflow ? WORKFLOW_LABELS[workflow] : "—"}</dd>
          </div>
          {workflow === "extract" ? (
            <div>
              <dt>OCR method</dt>
              <dd>{EXTRACTOR_LABELS[displaySettings.extractorChoice]}</dd>
            </div>
          ) : null}
          {(workflow === "extract" || workflow === "enrich") && displaySettings.extractionDeployment ? (
            <div>
              <dt>Extraction model</dt>
              <dd>{displaySettings.extractionDeployment}</dd>
            </div>
          ) : null}
          {(workflow === "extract" || workflow === "enrich") && displaySettings.acrfSummaryDeployment ? (
            <div>
              <dt>aCRF summary model</dt>
              <dd>{displaySettings.acrfSummaryDeployment}</dd>
            </div>
          ) : null}
          <div>
            <dt>Protocol</dt>
            <dd>
              {summary?.uploads.protocol.uploaded
                ? `${summary.uploads.protocol.fileName} (${formatBytes(summary.uploads.protocol.size)})`
                : "Not uploaded"}
            </dd>
          </div>
          <div>
            <dt>aCRF</dt>
            <dd>
              {summary?.uploads.acrf.uploaded
                ? `${summary.uploads.acrf.fileName} (${formatBytes(summary.uploads.acrf.size)})`
                : "Not uploaded"}
            </dd>
          </div>
          {workflow === "map" || workflow === "enrich" ? (
            <div>
              <dt>PD Specifications</dt>
              <dd>
                {summary?.uploads.pdSpec.uploaded
                  ? `${summary.uploads.pdSpec.fileName} (${formatBytes(summary.uploads.pdSpec.size)})`
                  : "Not uploaded"}
              </dd>
            </div>
          ) : null}
          {activeRunId ? (
            <div>
              <dt>Active run</dt>
              <dd>{activeRunId}</dd>
            </div>
          ) : null}
        </dl>
      </section>
    </section>
  );
}
