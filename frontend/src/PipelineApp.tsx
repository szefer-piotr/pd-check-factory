import { useCallback, useEffect, useMemo, useState } from "react";
import { Page } from "./components/layout/Page";
import { ActivityPanel } from "./components/pipeline/ActivityPanel";
import { ToastStack } from "./components/pipeline/ToastStack";
import { CostAnalysisStepPage } from "./pages/pipeline/CostAnalysisStepPage";
import { GeneratePdStepPage } from "./pages/pipeline/GeneratePdStepPage";
import { ReviewStepPage } from "./pages/pipeline/ReviewStepPage";
import { StudySetupStepPage } from "./pages/pipeline/StudySetupStepPage";
import { PipelineJobProvider, usePipelineJobs } from "./jobs/PipelineJobContext";
import {
  GENERATE_PD_CHILDREN,
  PIPELINE_STEPS,
  pipelineStepById,
  pipelineStepIndex,
  type GeneratePdSubStep,
  type PipelineStepId,
  type StudySetupSection
} from "./pipeline/pipelineSteps";
import {
  canonicalizePipelineHash,
  navigateToPipelineStep,
  parsePipelineHash,
  pipelineHashForStep
} from "./pipeline/pipelineRoute";
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
    processingComplete: boolean;
    backendStatuses: Record<string, StepStatus>;
  }
): boolean {
  switch (stepId) {
    case "study-setup":
      return Boolean(ctx.studyId.trim()) && ctx.hasAppliedSettings && ctx.processingComplete;
    case "generate-pd":
      return (
        ctx.backendStatuses["extract-rules"] === "done" &&
        ctx.backendStatuses["extract-deviations"] === "done"
      );
    case "review":
    case "cost-analysis":
      return ctx.backendStatuses["extract-deviations"] === "done";
    default:
      return false;
  }
}

function PipelineAppInner(): JSX.Element {
  const jobs = usePipelineJobs();
  const [route, setRoute] = useState(() => parsePipelineHash(window.location.hash));
  const [backendStatuses, setBackendStatuses] = useState<Record<string, StepStatus>>({});
  const [processingComplete, setProcessingComplete] = useState(false);
  const [llmDeployments, setLlmDeployments] = useState<OpenAiDeploymentOption[]>([]);
  const [defaultDeployment, setDefaultDeployment] = useState("");
  const [deploymentsLoading, setDeploymentsLoading] = useState(true);
  const [resetError, setResetError] = useState("");
  const [resetMessage, setResetMessage] = useState("");
  const [isResetting, setIsResetting] = useState(false);

  const studyId = jobs.studyId;
  const setStudyId = jobs.setStudyId;

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
    pollMs: jobs.isRunActive ? 3000 : 0
  });

  useEffect(() => {
    const syncRoute = (): void => {
      const canonical = canonicalizePipelineHash(window.location.hash);
      if (canonical && window.location.hash !== canonical) {
        window.location.replace(canonical);
        return;
      }
      const parsed = parsePipelineHash(window.location.hash);
      setRoute(parsed);
      if (parsed.studyId && parsed.studyId !== studyId) {
        setStudyId(parsed.studyId);
      }
    };
    syncRoute();
    window.addEventListener("hashchange", syncRoute);
    return () => window.removeEventListener("hashchange", syncRoute);
  }, [setStudyId, studyId]);

  useEffect(() => {
    if (!studyId.trim()) {
      return;
    }
    const desired = pipelineHashForStep(route.stepId, {
      subStep: route.subStep,
      section: route.section,
      studyId
    });
    if (window.location.hash !== desired && !window.location.hash.includes("study=")) {
      window.history.replaceState(null, "", desired);
    } else if (studyId && !parsePipelineHash(window.location.hash).studyId) {
      window.history.replaceState(null, "", desired);
    }
  }, [route.section, route.stepId, route.subStep, studyId]);

  useEffect(() => {
    if (summary?.preprocess) {
      setProcessingComplete(Boolean(summary.preprocess.protocol && summary.preprocess.acrf));
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
    if (!jobs.isRunActive) {
      return;
    }
    const handler = (event: BeforeUnloadEvent): void => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [jobs.isRunActive]);

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
      processingComplete,
      backendStatuses
    }),
    [backendStatuses, hasAppliedSettings, processingComplete, studyId]
  );

  const canNavigateTo = useCallback(
    (targetId: PipelineStepId): boolean => {
      const targetIndex = pipelineStepIndex(targetId);
      if (targetIndex <= 0) {
        return true;
      }
      for (let index = 0; index < targetIndex; index += 1) {
        const prior = PIPELINE_STEPS[index];
        if (!stepComplete(prior.id, completionCtx)) {
          return false;
        }
      }
      return true;
    },
    [completionCtx]
  );

  function handleNavigate(
    stepId: PipelineStepId,
    options: { subStep?: GeneratePdSubStep; section?: StudySetupSection } = {}
  ): void {
    if (!canNavigateTo(stepId)) {
      return;
    }
    navigateToPipelineStep(stepId, { ...options, studyId });
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
    await patchStudyManifest(studyId.trim(), { workflowChoice: "extract", pipelineUiStep: "study-setup" });
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
      setProcessingComplete(false);
      setResetMessage(result.message);
      navigateToPipelineStep("study-setup", { section: "study", studyId });
    } catch (resetErr) {
      setResetError(resetErr instanceof Error ? resetErr.message : "Reset failed.");
    } finally {
      setIsResetting(false);
    }
  }

  function renderStep(): JSX.Element {
    switch (route.stepId) {
      case "study-setup":
        return (
          <StudySetupStepPage
            studyId={studyId}
            onStudyIdChange={(value) => {
              setStudyId(value);
              navigateToPipelineStep("study-setup", {
                section: route.section ?? "study",
                studyId: value
              });
            }}
            section={route.section}
            settings={draftSettings}
            onSettingsChange={updateDraftSettings}
            onSaveConfig={() => void handleSaveConfig()}
            configSaved={hasAppliedSettings}
            deployments={llmDeployments}
            deploymentsLoading={deploymentsLoading}
            defaultDeployment={defaultDeployment}
            onStatusesChange={setBackendStatuses}
            onProcessingCompleteChange={setProcessingComplete}
            onRefreshSummary={refreshSummary}
            onStudyCreated={() => handleNavigate("study-setup", { section: "config" })}
          />
        );
      case "generate-pd":
        return (
          <GeneratePdStepPage
            studyId={studyId}
            subStep={route.subStep ?? "rules"}
            settings={effectiveSettings}
            defaultDeployment={defaultDeployment}
            backendStatuses={backendStatuses}
            onStatusesChange={setBackendStatuses}
            llmDeployments={llmDeployments}
            deploymentsLoading={deploymentsLoading}
            chatDeployment={chatDeployment}
            onChatDeploymentChange={(value) => updateDraftSettings({ chatDeployment: value })}
            onSubStepChange={(subStep) => handleNavigate("generate-pd", { subStep })}
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
      case "cost-analysis":
        return <CostAnalysisStepPage studyId={studyId} />;
      default:
        return (
          <StudySetupStepPage
            studyId={studyId}
            onStudyIdChange={setStudyId}
            settings={draftSettings}
            onSettingsChange={updateDraftSettings}
            onSaveConfig={() => void handleSaveConfig()}
            configSaved={hasAppliedSettings}
            deployments={llmDeployments}
            deploymentsLoading={deploymentsLoading}
            defaultDeployment={defaultDeployment}
            onStatusesChange={setBackendStatuses}
            onProcessingCompleteChange={setProcessingComplete}
            onRefreshSummary={refreshSummary}
            onStudyCreated={() => handleNavigate("study-setup", { section: "config" })}
          />
        );
    }
  }

  const currentStep = pipelineStepById(route.stepId) ?? PIPELINE_STEPS[0];

  return (
    <Page>
      <div className="pipeline-shell">
        <header className="pipeline-topbar">
          <div>
            <strong>PD Check Pipeline</strong>
            {studyId ? <span className="pipeline-topbar-study">{studyId}</span> : null}
          </div>
          <div className="pipeline-topbar-actions">
            <button
              type="button"
              className={`button button-secondary ${jobs.isRunActive ? "pipeline-activity-trigger-live" : ""}`}
              onClick={() => jobs.setActivityOpen(true)}
            >
              {jobs.isRunActive ? (
                <>
                  <span className="spinner spinner-sm" aria-hidden />
                  Activity
                </>
              ) : (
                "Activity"
              )}
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={!studyId.trim() || isResetting}
              onClick={() => void handleResetStudy()}
            >
              {isResetting ? "Resetting…" : "Reset study"}
            </button>
            <button
              type="button"
              className="button button-secondary"
              disabled={!studyId.trim()}
              onClick={() => void refreshStatuses()}
            >
              Refresh status
            </button>
          </div>
        </header>

        {resetError ? <p className="pipeline-error pipeline-global-message">{resetError}</p> : null}
        {resetMessage ? <p className="pipeline-message pipeline-global-message">{resetMessage}</p> : null}

        <div className="pipeline-body">
          <nav className="pipeline-sidebar" aria-label="Pipeline steps">
            <ol>
              {PIPELINE_STEPS.map((step) => {
                const done = stepComplete(step.id, completionCtx);
                const active = step.id === route.stepId;
                const enabled = canNavigateTo(step.id);
                return (
                  <li key={step.id}>
                    <button
                      type="button"
                      className={`pipeline-sidebar-item ${active ? "active" : ""} ${done ? "done" : ""}`}
                      disabled={!enabled}
                      onClick={() =>
                        handleNavigate(
                          step.id,
                          step.id === "generate-pd" ? { subStep: route.subStep ?? "rules" } : undefined
                        )
                      }
                    >
                      <span className="pipeline-sidebar-title">{step.shortTitle}</span>
                      <span className="pipeline-sidebar-state">
                        {done ? "Done" : active ? "Current" : "Pending"}
                      </span>
                    </button>
                    {step.id === "generate-pd" && active ? (
                      <ul className="pipeline-sidebar-children">
                        {GENERATE_PD_CHILDREN.map((child) => {
                          const childDone = backendStatuses[child.backendStepId] === "done";
                          const childActive = (route.subStep ?? "rules") === child.id;
                          return (
                            <li key={child.id}>
                              <button
                                type="button"
                                className={`pipeline-sidebar-item pipeline-sidebar-child ${childActive ? "active" : ""} ${childDone ? "done" : ""}`}
                                onClick={() => handleNavigate("generate-pd", { subStep: child.id })}
                              >
                                <span className="pipeline-sidebar-title">{child.shortTitle}</span>
                                <span className="pipeline-sidebar-state">{childDone ? "Done" : "Pending"}</span>
                              </button>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ol>

            {route.stepId === "generate-pd" ? (
              <div className="pipeline-sidebar-meta">
                <p className="pipeline-sidebar-meta-title">Current</p>
                <p className="pipeline-sidebar-meta-body">{currentStep.title}</p>
                <p className="pipeline-hint">Artifact versions and previews live beside the work surface.</p>
              </div>
            ) : null}
          </nav>

          <main className="pipeline-main">{renderStep()}</main>
        </div>

        <ActivityPanel
          open={jobs.activityOpen}
          onClose={() => jobs.setActivityOpen(false)}
          isRunActive={jobs.isRunActive}
          activeJobLabel={jobs.activeJobLabel}
          queueLength={jobs.queueLength}
          logs={jobs.logs}
          llmProgress={jobs.llmProgress}
          runStateStatus={jobs.runStateStatus}
        />
        <ToastStack toasts={jobs.toasts} onDismiss={jobs.dismissToast} />
      </div>
    </Page>
  );
}

export function PipelineApp(): JSX.Element {
  return (
    <PipelineJobProvider>
      <PipelineAppInner />
    </PipelineJobProvider>
  );
}

export { pipelineHashForStep };
