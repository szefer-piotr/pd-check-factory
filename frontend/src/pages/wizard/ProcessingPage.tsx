import { useCallback, useMemo, useState } from "react";
import { DocumentPreviewModal } from "../../components/workflow/DocumentPreviewModal";
import { PipelineLogTicker } from "../../components/workflow/PipelineLogTicker";
import { ProcessingStepRow } from "../../components/workflow/ProcessingStepRow";
import { BACKEND_STEP_LABELS, WORKFLOW_STEP_IDS, reviewSourceForWorkflow, type WorkflowChoice } from "../../data/wizardSteps";
import { usePipelineRunState } from "../../hooks/usePipelineRunState";
import type { StudySettings } from "../../hooks/useStudySettings";
import { deploymentForStep } from "../../hooks/useStudySettings";
import {
  fetchStepPreview,
  runStep,
  runStep1Extraction,
  setStep7ReviewDisplaySource,
  syncStudy,
  type Step1PdfExtractor,
  type PipelineLogLine,
  type StepStatus
} from "../../services/stepApi";
import { isWorkflowComplete } from "../../utils/workflowProgress";

interface ProcessingPageProps {
  studyId: string;
  workflow: WorkflowChoice | null;
  stepStatuses: Record<string, StepStatus>;
  settings: StudySettings;
  defaultDeployment: string;
  onStatusesChange: (statuses: Record<string, StepStatus>) => void;
  onRefreshSummary: () => Promise<void>;
  isRunActive: boolean;
  onRunActiveChange: (active: boolean) => void;
}

function buildRunOptions(
  stepId: string,
  settings: StudySettings,
  defaultDeployment: string,
  force: boolean
): { force: boolean; llmDeployment?: string; llmInstructions?: string } {
  const opts: { force: boolean; llmDeployment?: string; llmInstructions?: string } = { force };
  const deployment = deploymentForStep(stepId, settings, defaultDeployment);
  if (deployment) {
    opts.llmDeployment = deployment;
  }
  if (
    settings.extractionLlmInstructions.trim() &&
    (stepId === "extract-rules" || stepId === "extract-deviations" || stepId === "import-pd-spec-enrich")
  ) {
    opts.llmInstructions = settings.extractionLlmInstructions.trim();
  }
  return opts;
}

function logsForStep(logs: PipelineLogLine[], stepId: string): PipelineLogLine[] {
  const stepToken = stepId;
  const filtered = logs.filter(
    (line) =>
      line.text.includes(stepToken) ||
      line.text.includes("Starting step") ||
      line.text.includes("[llm-text]") ||
      line.text.includes("llm:")
  );
  return filtered.length > 0 ? filtered : logs;
}

export function ProcessingPage({
  studyId,
  workflow,
  stepStatuses,
  settings,
  defaultDeployment,
  onStatusesChange,
  onRefreshSummary,
  isRunActive,
  onRunActiveChange
}: ProcessingPageProps): JSX.Element {
  const [runningStepId, setRunningStepId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [hasSynced, setHasSynced] = useState(false);
  const [previewTitle, setPreviewTitle] = useState("");
  const [previewMarkdown, setPreviewMarkdown] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState("");

  const pollRunState = Boolean(studyId.trim()) && (isRunActive || Boolean(runningStepId));
  const { runState } = usePipelineRunState(studyId, { enabled: pollRunState, pollMs: 1500 });

  const stepIds = workflow ? WORKFLOW_STEP_IDS[workflow] : [];
  const complete = isWorkflowComplete(workflow, stepStatuses);
  const activeStepId = runningStepId ?? runState.currentSubStepId ?? "";

  const ensureSync = useCallback(async (): Promise<void> => {
    if (hasSynced || !studyId.trim()) {
      return;
    }
    setSyncing(true);
    try {
      const result = await syncStudy(studyId.trim());
      onStatusesChange(result.stepStatuses);
      setHasSynced(true);
    } catch {
      // Best-effort sync before pipeline run.
    } finally {
      setSyncing(false);
    }
  }, [hasSynced, onStatusesChange, studyId]);

  async function handleSync(): Promise<void> {
    if (!studyId.trim()) {
      return;
    }
    setSyncing(true);
    setError("");
    try {
      const result = await syncStudy(studyId.trim());
      onStatusesChange(result.stepStatuses);
      setHasSynced(true);
      setMessage("Synced from cloud.");
      await onRefreshSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed.");
    } finally {
      setSyncing(false);
    }
  }

  async function handleRunStep(stepId: string, force = false): Promise<void> {
    const trimmed = studyId.trim();
    if (!trimmed || runningStepId || isRunActive) {
      return;
    }
    setRunningStepId(stepId);
    setError("");
    setMessage(`Running ${BACKEND_STEP_LABELS[stepId] ?? stepId}…`);
    onRunActiveChange(true);
    try {
      await ensureSync();
      if (stepId === "extract-inputs") {
        const result = await runStep1Extraction(trimmed, settings.extractorChoice as Step1PdfExtractor, { force });
        onStatusesChange(result.stepStatuses);
        setMessage(result.message);
      } else {
        const result = await runStep(trimmed, stepId, buildRunOptions(stepId, settings, defaultDeployment, force));
        onStatusesChange(result.stepStatuses);
        setMessage(result.summary);
      }
      if (workflow && stepId === WORKFLOW_STEP_IDS[workflow][WORKFLOW_STEP_IDS[workflow].length - 2]) {
        await setStep7ReviewDisplaySource(trimmed, reviewSourceForWorkflow(workflow));
      }
      await onRefreshSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Step failed.");
      setMessage("");
    } finally {
      setRunningStepId(null);
      onRunActiveChange(false);
    }
  }

  async function handleRunAll(force = false): Promise<void> {
    const trimmed = studyId.trim();
    if (!trimmed || !workflow || runningStepId || isRunActive) {
      return;
    }
    onRunActiveChange(true);
    setError("");
    try {
      await ensureSync();
      let statuses = { ...stepStatuses };
      for (const stepId of stepIds) {
        if (stepId === "review-and-finalize") {
          continue;
        }
        if (!force && (statuses[stepId] === "done" || statuses[stepId] === "skipped")) {
          continue;
        }
        setRunningStepId(stepId);
        setMessage(`Running ${BACKEND_STEP_LABELS[stepId] ?? stepId}…`);
        if (stepId === "extract-inputs") {
          const result = await runStep1Extraction(trimmed, settings.extractorChoice as Step1PdfExtractor, { force });
          statuses = result.stepStatuses;
        } else {
          const result = await runStep(trimmed, stepId, buildRunOptions(stepId, settings, defaultDeployment, force));
          statuses = result.stepStatuses;
        }
        onStatusesChange(statuses);
      }
      await setStep7ReviewDisplaySource(trimmed, reviewSourceForWorkflow(workflow));
      setMessage("Processing complete.");
      await onRefreshSummary();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Processing failed.");
      setMessage("");
    } finally {
      setRunningStepId(null);
      onRunActiveChange(false);
    }
  }

  async function handlePreview(stepId: string): Promise<void> {
    const trimmed = studyId.trim();
    if (!trimmed) {
      return;
    }
    setPreviewOpen(true);
    setPreviewTitle(BACKEND_STEP_LABELS[stepId] ?? stepId);
    setPreviewMarkdown("");
    setPreviewError("");
    setPreviewLoading(true);
    try {
      const preview = await fetchStepPreview(trimmed, stepId);
      const body = preview.previews.map((item) => `### ${item.title}\n\n${item.body}`).join("\n\n");
      setPreviewMarkdown(body || "No preview content.");
    } catch (err) {
      setPreviewError(err instanceof Error ? err.message : "Preview failed.");
    } finally {
      setPreviewLoading(false);
    }
  }

  const globalLogs = useMemo(() => runState.logs, [runState.logs]);

  return (
    <section className="wizard-processing" aria-label="Processing">
      <header className="wizard-page-header">
        <h2>Processing</h2>
        <div className="wizard-processing-actions">
          <button className="button button-secondary" type="button" onClick={() => void handleSync()} disabled={syncing}>
            {syncing ? "Syncing…" : "Sync from cloud"}
          </button>
          <button
            className="button button-primary"
            type="button"
            onClick={() => void handleRunAll(false)}
            disabled={!workflow || Boolean(runningStepId) || isRunActive}
          >
            Run all
          </button>
          <button
            className="button button-secondary"
            type="button"
            onClick={() => void handleRunAll(true)}
            disabled={!workflow || Boolean(runningStepId) || isRunActive}
          >
            Re-run all
          </button>
        </div>
      </header>

      <PipelineLogTicker logs={globalLogs} active={pollRunState} className="wizard-processing-log-ticker" />

      {message ? <p className="step1-status">{message}</p> : null}
      {error ? <p className="step1-error">{error}</p> : null}
      {complete ? (
        <p className="wizard-processing-complete" role="status">
          All processing steps are complete. Continue to Review when ready.
        </p>
      ) : null}

      <ul className="wizard-processing-steps">
        {stepIds.map((stepId) => {
          if (stepId === "review-and-finalize") {
            return null;
          }
          const status = stepStatuses[stepId] ?? "pending";
          const isRunning = runningStepId === stepId;
          const isActiveStep = activeStepId === stepId;
          return (
            <ProcessingStepRow
              key={stepId}
              stepId={stepId}
              label={BACKEND_STEP_LABELS[stepId] ?? stepId}
              status={status}
              isRunning={isRunning}
              isActiveStep={isActiveStep}
              llmProgress={runState.llmProgress}
              stepLogs={logsForStep(runState.logs, stepId)}
              runActive={pollRunState}
              onRun={() => void handleRunStep(stepId, false)}
              onReRun={() => void handleRunStep(stepId, true)}
              onPreview={() => void handlePreview(stepId)}
              actionsDisabled={Boolean(runningStepId) || isRunActive}
              previewLoading={previewLoading}
            />
          );
        })}
      </ul>

      <DocumentPreviewModal
        open={previewOpen}
        title={previewTitle}
        kind="markdown"
        markdownContent={previewMarkdown}
        tableRows={[]}
        spreadsheetColumns={[]}
        spreadsheetRows={[]}
        isLoading={previewLoading}
        error={previewError}
        onClose={() => setPreviewOpen(false)}
      />
    </section>
  );
}
