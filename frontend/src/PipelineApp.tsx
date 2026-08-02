import { useCallback, useEffect, useMemo, useState } from "react";
import { Page } from "./components/layout/Page";
import { BackendRunStepPage } from "./pages/pipeline/BackendRunStepPage";
import { ConfigStepPage } from "./pages/pipeline/ConfigStepPage";
import { CostAnalysisStepPage } from "./pages/pipeline/CostAnalysisStepPage";
import { ExportStepPage } from "./pages/pipeline/ExportStepPage";
import { ReviewStepPage } from "./pages/pipeline/ReviewStepPage";
import { StudyStepPage } from "./pages/pipeline/StudyStepPage";
import { UploadStepPage } from "./pages/pipeline/UploadStepPage";
import {
  PIPELINE_STEPS,
  pipelineStepById,
  pipelineStepIndex,
  type PipelineStepId
} from "./pipeline/pipelineSteps";
import { navigateToPipelineStep, parsePipelineHash, pipelineHashForStep } from "./pipeline/pipelineRoute";
import { applyDefaultDeployments, useStudySettings } from "./hooks/useStudySettings";
import { useStudySummary } from "./hooks/useStudySummary";
import {
  applyStudyRun,
  fetchOpenAiDeployments,
  fetchStepStatuses,
  patchStudyManifest,
  resetStudy,
  type OpenAiDeploymentOption,
  type StepStatus
} from "./services/stepApi";

function stepComplete(
  stepId: PipelineStepId,
  ctx: {
    studyId: string;
    hasAppliedSettings: boolean;
    bothUploaded: boolean;
    backendStatuses: Record<string, StepStatus>;
  }
): boolean {
  const step = pipelineStepById(stepId);
  if (!step) {
    return false;
  }
  switch (stepId) {
    case "study":
      return Boolean(ctx.studyId.trim());
    case "config":
      return ctx.hasAppliedSettings;
    case "upload":
      return ctx.bothUploaded;
    case "review":
    case "export":
    case "cost-analysis":
      return ctx.backendStatuses["extract-deviations"] === "done";
    default:
      return step.backendStepId ? ctx.backendStatuses[step.backendStepId] === "done" : false;
  }
}

export function PipelineApp(): JSX.Element {
  const [currentStepId, setCurrentStepId] = useState<PipelineStepId>(() => parsePipelineHash(window.location.hash));
  const [studyId, setStudyId] = useState("");
  const [backendStatuses, setBackendStatuses] = useState<Record<string, StepStatus>>({});
  const [bothUploaded, setBothUploaded] = useState(false);
  const [isRunActive, setIsRunActive] = useState(false);
  const [llmDeployments, setLlmDeployments] = useState<OpenAiDeploymentOption[]>([]);
  const [defaultDeployment, setDefaultDeployment] = useState("");
  const [deploymentsLoading, setDeploymentsLoading] = useState(true);
  const [resetError, setResetError] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [isResetting, setIsResetting] = useState(false);

  const {
    draftSettings,
    appliedSettings,
    updateDraftSettings,
    applySettings,
    hasAppliedSettings
  } = useStudySettings(studyId);

  const effectiveSettings = useMemo(
    () => applyDefaultDeployments(appliedSettings ?? draftSettings, defaultDeployment),
    [appliedSettings, draftSettings, defaultDeployment]
  );

  const chatDeployment = draftSettings.chatDeployment || defaultDeployment;

  const { summary, refresh: refreshSummary } = useStudySummary(studyId, {
    enabled: Boolean(studyId.trim()),
    pollMs: isRunActive ? 3000 : 0
  });

  useEffect(() => {
    const onHashChange = (): void => setCurrentStepId(parsePipelineHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    if (summary?.uploads) {
      setBothUploaded(summary.bothUploaded);
    }
    if (summary?.stepStatuses) {
      setBackendStatuses(summary.stepStatuses);
    }
  }, [summary]);

  useEffect(() => {
    let cancelled = false;
    async function loadDeployments(): Promise<void> {
      setDeploymentsLoading(true);
      try {
        const result = await fetchOpenAiDeployments();
        if (!cancelled) {
          setLlmDeployments(result.deployments);
          setDefaultDeployment(result.defaultDeployment);
        }
      } finally {
        if (!cancelled) {
          setDeploymentsLoading(false);
        }
      }
    }
    void loadDeployments();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isRunActive) {
      return;
    }
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [isRunActive]);

  const refreshStatuses = useCallback(async (): Promise<void> => {
    if (!studyId.trim()) {
      return;
    }
    const status = await fetchStepStatuses(studyId.trim());
    setBackendStatuses(
      Object.fromEntries(status.steps.map((step) => [step.stepId, step.status])) as Record<string, StepStatus>
    );
    await refreshSummary();
  }, [refreshSummary, studyId]);

  const completionCtx = useMemo(
    () => ({
      studyId,
      hasAppliedSettings,
      bothUploaded,
      backendStatuses
    }),
    [backendStatuses, bothUploaded, hasAppliedSettings, studyId]
  );

  const canNavigateTo = useCallback(
    (targetId: PipelineStepId): boolean => {
      if (isRunActive) {
        return targetId === currentStepId;
      }
      const targetIndex = pipelineStepIndex(targetId);
      if (targetIndex <= 0) {
        return true;
      }
      for (let index = 0; index < targetIndex; index += 1) {
        const prior = PIPELINE_STEPS[index];
        if (!stepComplete(prior.id, completionCtx)) {
          return index === targetIndex - 1;
        }
      }
      return true;
    },
    [completionCtx, currentStepId, isRunActive]
  );

  function handleNavigate(stepId: PipelineStepId): void {
    if (!canNavigateTo(stepId)) {
      return;
    }
    navigateToPipelineStep(stepId);
    if (studyId.trim()) {
      void patchStudyManifest(studyId.trim(), {
        workflowChoice: "extract",
        pipelineUiStep: stepId
      });
    }
  }

  async function handleSaveConfig(): Promise<void> {
    const normalized = applyDefaultDeployments(draftSettings, defaultDeployment);
    applySettings(normalized);
    if (!studyId.trim()) {
      return;
    }
    await applyStudyRun(studyId.trim(), {
      workflow: "extract",
      uploads: {
        protocolFileName: summary?.uploads.protocol.fileName ?? "protocol.pdf",
        acrfFileName: summary?.uploads.acrf.fileName ?? "acrf.pdf",
        pdSpecFileName: null
      },
      settings: {
        extractorChoice: "document_intelligence",
        extractionDeployment: normalized.extractionDeployment || defaultDeployment,
        acrfSummaryDeployment: normalized.acrfSummaryDeployment || defaultDeployment,
        extractionLlmInstructions: normalized.extractionLlmInstructions
      }
    });
    await patchStudyManifest(studyId.trim(), { workflowChoice: "extract", pipelineUiStep: "config" });
  }

  async function handleResetStudy(): Promise<void> {
    if (!studyId.trim()) {
      return;
    }
    if (
      !window.confirm(
        `Reset study ${studyId}? This deletes all blob and local artifacts for this study. Chat history and deviations will be lost.`
      )
    ) {
      return;
    }
    setIsResetting(true);
    setResetError("");
    setResetMessage("");
    try {
      const result = await resetStudy(studyId.trim());
      setBackendStatuses(result.stepStatuses);
      setBothUploaded(false);
      setResetMessage(result.message);
      navigateToPipelineStep("study");
    } catch (resetErr) {
      setResetError(resetErr instanceof Error ? resetErr.message : "Reset failed.");
    } finally {
      setIsResetting(false);
    }
  }

  const currentStep = pipelineStepById(currentStepId) ?? PIPELINE_STEPS[0];

  function renderStep(): JSX.Element {
    switch (currentStepId) {
      case "study":
        return (
          <StudyStepPage
            studyId={studyId}
            onStudyIdChange={setStudyId}
            onCreated={() => void handleNavigate("config")}
          />
        );
      case "config":
        return (
          <ConfigStepPage
            settings={draftSettings}
            onChange={updateDraftSettings}
            onSave={() => void handleSaveConfig()}
            saved={hasAppliedSettings}
            deployments={llmDeployments}
            deploymentsLoading={deploymentsLoading}
            defaultDeployment={defaultDeployment}
          />
        );
      case "upload":
        return (
          <UploadStepPage
            studyId={studyId}
            onStatusesChange={setBackendStatuses}
            onBothUploadedChange={setBothUploaded}
            onRefreshSummary={refreshSummary}
          />
        );
      case "review":
        return (
          <ReviewStepPage
            studyId={studyId}
            onStatusesChange={setBackendStatuses}
            llmDeployments={llmDeployments}
            deploymentsLoading={deploymentsLoading}
            chatDeployment={chatDeployment}
            onChatDeploymentChange={(value) => updateDraftSettings({ chatDeployment: value })}
          />
        );
      case "export":
        return <ExportStepPage studyId={studyId} />;
      case "cost-analysis":
        return <CostAnalysisStepPage studyId={studyId} />;
      default:
        return (
          <BackendRunStepPage
            studyId={studyId}
            step={currentStep}
            settings={effectiveSettings}
            defaultDeployment={defaultDeployment}
            backendStatuses={backendStatuses}
            onStatusesChange={setBackendStatuses}
            isRunActive={isRunActive}
            onRunActiveChange={setIsRunActive}
          />
        );
    }
  }

  return (
    <Page>
    <div className="pipeline-shell">
      <header className="pipeline-topbar">
        <div>
          <strong>PD Check Pipeline</strong>
          {studyId ? <span className="pipeline-topbar-study">{studyId}</span> : null}
        </div>
        <div className="pipeline-topbar-actions">
          <button type="button" className="secondary" disabled={!studyId.trim() || isResetting} onClick={() => void handleResetStudy()}>
            {isResetting ? "Resetting…" : "Reset study"}
          </button>
          <button type="button" className="secondary" disabled={!studyId.trim()} onClick={() => void refreshStatuses()}>
            Refresh status
          </button>
        </div>
      </header>

      {resetError ? <p className="pipeline-error pipeline-global-message">{resetError}</p> : null}
      {resetMessage ? <p className="pipeline-message pipeline-global-message">{resetMessage}</p> : null}

      {isRunActive ? (
        <div className="pipeline-run-banner pipeline-run-banner-global" role="status">
          Processing in progress — do not close the browser.
        </div>
      ) : null}

      <div className="pipeline-body">
        <nav className="pipeline-sidebar" aria-label="Pipeline steps">
          <ol>
            {PIPELINE_STEPS.map((step) => {
              const done = stepComplete(step.id, completionCtx);
              const active = step.id === currentStepId;
              const enabled = canNavigateTo(step.id);
              return (
                <li key={step.id}>
                  <button
                    type="button"
                    className={`pipeline-sidebar-item ${active ? "active" : ""} ${done ? "done" : ""}`}
                    disabled={!enabled}
                    onClick={() => handleNavigate(step.id)}
                  >
                    <span className="pipeline-sidebar-title">{step.shortTitle}</span>
                    <span className="pipeline-sidebar-state">{done ? "Done" : active ? "Current" : "Pending"}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </nav>

        <main className="pipeline-main">{renderStep()}</main>
      </div>
    </div>
    </Page>
  );
}

export { pipelineHashForStep };
