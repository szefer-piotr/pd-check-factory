import { useCallback, useEffect, useMemo, useState } from "react";
import { useStudyContext } from "../../hooks/useStudyContext";
import {
  fetchStep1RunState,
  fetchStepPreview,
  fetchStepStatuses,
  type Step1RunStateResponse,
  type StepPreviewResponse,
  type StepStatusesResponse
} from "../../services/stepApi";
import {
  derivePipelineStepStatus,
  getWorkflowSteps,
  isWorkflowExtractionComplete,
  stepLabel,
  type ProcessingStepStatus
} from "../../utils/processingSteps";
import { LlmProgressBar } from "./LlmProgressBar";
import { WorkflowStageNav } from "./WorkflowStageNav";

function statusIcon(status: ProcessingStepStatus): string {
  if (status === "done") {
    return "✓";
  }
  if (status === "running") {
    return "…";
  }
  if (status === "failed") {
    return "!";
  }
  if (status === "skipped") {
    return "–";
  }
  return "○";
}

interface PipelineStatusDrawerProps {
  collapsed?: boolean;
  onCollapsedChange?: (collapsed: boolean) => void;
}

export function PipelineStatusDrawer({
  collapsed: collapsedProp,
  onCollapsedChange
}: PipelineStatusDrawerProps): JSX.Element | null {
  const { studyId, summary, refresh, pipelineRunner } = useStudyContext();
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const collapsed = collapsedProp ?? internalCollapsed;
  const setCollapsed = onCollapsedChange ?? setInternalCollapsed;

  const [stepStatusesResponse, setStepStatusesResponse] = useState<StepStatusesResponse | null>(null);
  const [runState, setRunState] = useState<Step1RunStateResponse | null>(null);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [preview, setPreview] = useState<StepPreviewResponse | null>(null);
  const [actionError, setActionError] = useState("");

  const workflow = summary?.workflow;
  const stepStatuses =
    summary?.stepStatuses ??
    Object.fromEntries((stepStatusesResponse?.steps ?? []).map((step) => [step.stepId, step.status]));
  const workflowSteps = useMemo(() => getWorkflowSteps(workflow), [workflow]);
  const extractionComplete = isWorkflowExtractionComplete(workflow, stepStatuses);
  const nextStepId = useMemo(() => {
    if (stepStatusesResponse?.nextStepId) {
      return stepStatusesResponse.nextStepId;
    }
    for (const stepId of workflowSteps) {
      const status = stepStatuses[stepId];
      if (status !== "done" && status !== "skipped") {
        return stepId;
      }
    }
    return null;
  }, [stepStatuses, stepStatusesResponse?.nextStepId, workflowSteps]);

  const visible =
    Boolean(studyId.trim()) &&
    Boolean(workflow) &&
    (!extractionComplete || pipelineRunner.isRunning || Boolean(pipelineRunner.lastError));

  const pollState = useCallback(async () => {
    const trimmed = studyId.trim();
    if (!trimmed) {
      return;
    }
    try {
      const [statuses, state] = await Promise.all([
        fetchStepStatuses(trimmed),
        fetchStep1RunState(trimmed)
      ]);
      setStepStatusesResponse(statuses);
      setRunState(state);
    } catch {
      // best-effort polling
    }
  }, [studyId]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    void pollState();
    const timer = window.setInterval(() => void pollState(), 2500);
    return () => window.clearInterval(timer);
  }, [pollState, visible, pipelineRunner.isRunning]);

  useEffect(() => {
    if (!selectedStepId || !studyId.trim()) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    void fetchStepPreview(studyId.trim(), selectedStepId)
      .then((response) => {
        if (!cancelled) {
          setPreview(response);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setPreview(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedStepId, studyId]);

  const effectiveRunState = runState ?? {
    studyId: studyId.trim(),
    status: summary?.runState.status ?? "idle",
    currentStage: "",
    currentSubStepId: summary?.runState.currentSubStepId ?? "",
    message: "",
    error: "",
    startedAt: "",
    finishedAt: "",
    logs: [],
    llmProgress: summary?.runState.llmProgress ?? null
  };

  async function handleRunRemaining(): Promise<void> {
    setActionError("");
    try {
      await pipelineRunner.runRemaining();
      await refresh();
      await pollState();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to continue pipeline.");
    }
  }

  async function handleRunSelected(): Promise<void> {
    if (!selectedStepId) {
      return;
    }
    setActionError("");
    try {
      await pipelineRunner.runSingleStep(selectedStepId, { force: false });
      await refresh();
      await pollState();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to run step.");
    }
  }

  async function handleRerun(stepId: string): Promise<void> {
    const confirmed = window.confirm(
      "Re-running this step will require re-running downstream steps. Continue?"
    );
    if (!confirmed) {
      return;
    }
    setActionError("");
    try {
      await pipelineRunner.runSingleStep(stepId, { force: true });
      await refresh();
      await pollState();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to re-run step.");
    }
  }

  async function handleFinalize(): Promise<void> {
    setActionError("");
    try {
      await pipelineRunner.finalize();
      await refresh();
      await pollState();
    } catch (error) {
      setActionError(error instanceof Error ? error.message : "Unable to finalize.");
    }
  }

  if (!visible) {
    return null;
  }

  if (collapsed) {
    return (
      <div className="progress-dock progress-dock-collapsed">
        <button
          className="button button-secondary button-small pipeline-progress-drawer-toggle"
          type="button"
          onClick={() => setCollapsed(false)}
          aria-expanded="false"
          aria-label="Open pipeline status"
        >
          Pipeline
        </button>
      </div>
    );
  }

  return (
    <aside className="progress-dock" aria-label="Pipeline status">
      <header className="progress-dock-header">
        <span className="progress-dock-title">Pipeline</span>
        {pipelineRunner.isRunning || effectiveRunState.status === "running" ? (
          <span className="progress-dock-live" aria-live="polite">
            Live
          </span>
        ) : null}
        <button
          className="button button-secondary button-small pipeline-progress-drawer-toggle"
          type="button"
          onClick={() => setCollapsed(true)}
          aria-expanded="true"
          aria-label="Collapse pipeline status"
        >
          −
        </button>
      </header>

      <WorkflowStageNav
        studyId={studyId}
        workflow={workflow}
        uiStage={summary?.uiStage}
        stepStatuses={stepStatuses}
      />

      {pipelineRunner.lastError ? (
        <p className="step1-error" role="alert">
          {pipelineRunner.lastError}
        </p>
      ) : null}
      {actionError ? (
        <p className="step1-error" role="alert">
          {actionError}
        </p>
      ) : null}

      <div className="step-navigation" role="list">
        {workflowSteps.map((stepId) => {
          const status = derivePipelineStepStatus(stepId, effectiveRunState, stepStatuses, workflowSteps);
          const isSelected = selectedStepId === stepId;
          return (
            <div key={stepId} className="step-nav-row" role="listitem">
              <button
                type="button"
                className={`step-nav-item${isSelected ? " step-nav-item-active" : ""} step-nav-item-${status}`}
                onClick={() => setSelectedStepId(stepId)}
              >
                <span className="step-nav-item-icon" aria-hidden="true">
                  {statusIcon(status)}
                </span>
                <span className="step-nav-item-label">{stepLabel(stepId)}</span>
              </button>
              <button
                className="button button-secondary button-small button-compact-rerun"
                type="button"
                disabled={pipelineRunner.isRunning}
                onClick={() => void handleRerun(stepId)}
              >
                Re-run
              </button>
            </div>
          );
        })}
      </div>

      {selectedStepId ? (
        <div className="pipeline-drawer-step-detail">
          <h4 className="pipeline-progress-phase-title">{stepLabel(selectedStepId)}</h4>
          {effectiveRunState.status === "running" &&
          effectiveRunState.currentSubStepId === selectedStepId &&
          effectiveRunState.llmProgress ? (
            <LlmProgressBar progress={effectiveRunState.llmProgress} />
          ) : null}
          {preview?.previews?.length ? (
            <details className="extraction-log-details" open>
              <summary>Preview</summary>
              {preview.previews.map((item) => (
                <div key={item.title} className="pipeline-drawer-preview-block">
                  <strong>{item.title}</strong>
                  <pre className="pipeline-drawer-preview-body">{item.body}</pre>
                </div>
              ))}
            </details>
          ) : null}
          {effectiveRunState.logs?.length ? (
            <details className="extraction-log-details">
              <summary>Activity log</summary>
              <ul className="pipeline-progress-log-list">
                {effectiveRunState.logs.slice(-12).map((line, index) => (
                  <li key={`${line.ts}-${index}`} className="pipeline-progress-log-line">
                    {line.text}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}

      <div className="pipeline-drawer-actions">
        {nextStepId && nextStepId !== "review-and-finalize" ? (
          <button
            className="button button-primary"
            type="button"
            disabled={pipelineRunner.isRunning}
            onClick={() => void handleRunRemaining()}
          >
            Run all remaining
          </button>
        ) : null}
        {selectedStepId ? (
          <button
            className="button button-secondary"
            type="button"
            disabled={pipelineRunner.isRunning}
            onClick={() => void handleRunSelected()}
          >
            Run this step
          </button>
        ) : null}
        {extractionComplete ? (
          <button
            className="button button-optional"
            type="button"
            disabled={pipelineRunner.isRunning}
            onClick={() => void handleFinalize()}
          >
            Finalize
          </button>
        ) : null}
      </div>
    </aside>
  );
}
