import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Page } from "./components/layout/Page";
import { ActivityPanel } from "./components/pipeline/ActivityPanel";
import { ToastStack } from "./components/pipeline/ToastStack";
import { CostAnalysisStepPage } from "./pages/pipeline/CostAnalysisStepPage";
import { DeviationsStepPage } from "./pages/pipeline/DeviationsStepPage";
import { RulesStepPage } from "./pages/pipeline/RulesStepPage";
import { StudySetupStepPage } from "./pages/pipeline/StudySetupStepPage";
import { PipelineJobProvider, usePipelineJobs } from "./jobs/PipelineJobContext";
import {
  PIPELINE_STEPS,
  pipelineStepIndex,
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
  fetchStudyRuns,
  patchStudyManifest,
  resetStudy,
  type OpenAiDeploymentOption,
  type StepStatus
} from "./services/stepApi";
import { RhoLogo, RhoMark } from "./components/brand/RhoLogo";

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
    case "rules":
      return ctx.backendStatuses["extract-rules"] === "done";
    case "deviations":
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
    loadAppliedSettings,
    hasAppliedSettings
  } = useStudySettings(studyId);

  const effectiveSettings = useMemo(
    () => applyDefaultDeployments(appliedSettings ?? draftSettings, defaultDeployment),
    [appliedSettings, draftSettings, defaultDeployment]
  );

  const chatDeployment = draftSettings.chatDeployment || defaultDeployment;
  const defaultDeploymentRef = useRef(defaultDeployment);
  defaultDeploymentRef.current = defaultDeployment;

  const { summary, refresh: refreshSummary } = useStudySummary(studyId, {
    enabled: Boolean(studyId.trim()),
    pollMs: jobs.isRunActive ? 3000 : 0
  });

  useEffect(() => {
    const id = studyId.trim();
    if (!id) {
      return;
    }
    let cancelled = false;

    async function restoreSettingsFromStudy(): Promise<void> {
      try {
        const runs = await fetchStudyRuns(id);
        if (cancelled) {
          return;
        }
        const active =
          runs.runs.find((run) => run.runId === runs.activeRunId) ?? runs.runs[0] ?? null;
        const raw = active?.settings;
        if (!raw) {
          return;
        }
        const extractionDeployment = String(raw.extractionDeployment || "").trim();
        const acrfSummaryDeployment = String(raw.acrfSummaryDeployment || "").trim();
        const chatDeploymentValue = String(raw.chatDeployment || "").trim();
        const instructions = String(raw.extractionLlmInstructions || "");
        if (!extractionDeployment && !acrfSummaryDeployment && !chatDeploymentValue && !instructions.trim()) {
          return;
        }
        loadAppliedSettings(
          applyDefaultDeployments(
            {
              extractorChoice:
                raw.extractorChoice === "both" ||
                raw.extractorChoice === "opendataloader" ||
                raw.extractorChoice === "document_intelligence"
                  ? raw.extractorChoice
                  : "document_intelligence",
              extractionLlmInstructions: instructions,
              extractionDeployment,
              acrfSummaryDeployment,
              chatDeployment: chatDeploymentValue
            },
            defaultDeploymentRef.current
          )
        );
      } catch {
        // Keep whatever local/session settings we already have.
      }
    }

    void restoreSettingsFromStudy();
    return () => {
      cancelled = true;
    };
  }, [studyId, loadAppliedSettings]);

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
      section: route.section,
      studyId
    });
    if (window.location.hash !== desired && !window.location.hash.includes("study=")) {
      window.history.replaceState(null, "", desired);
    } else if (studyId && !parsePipelineHash(window.location.hash).studyId) {
      window.history.replaceState(null, "", desired);
    }
  }, [route.section, route.stepId, studyId]);

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
    options: { section?: StudySetupSection } = {}
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
        chatDeployment: normalized.chatDeployment || defaultDeployment,
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
            processingComplete={processingComplete}
            deployments={llmDeployments}
            deploymentsLoading={deploymentsLoading}
            defaultDeployment={defaultDeployment}
            onStatusesChange={setBackendStatuses}
            onProcessingCompleteChange={setProcessingComplete}
            onRefreshSummary={refreshSummary}
            onStudyCreated={() => handleNavigate("study-setup", { section: "config" })}
          />
        );
      case "rules":
        return (
          <RulesStepPage
            studyId={studyId}
            settings={effectiveSettings}
            defaultDeployment={defaultDeployment}
            backendStatuses={backendStatuses}
            onStatusesChange={setBackendStatuses}
            chatDeployment={chatDeployment}
          />
        );
      case "deviations":
        return (
          <DeviationsStepPage
            studyId={studyId}
            settings={effectiveSettings}
            defaultDeployment={defaultDeployment}
            backendStatuses={backendStatuses}
            onStatusesChange={setBackendStatuses}
            chatDeployment={chatDeployment}
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
            processingComplete={processingComplete}
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

  return (
    <Page>
      <div className="pipeline-shell">
        <header className="pipeline-topbar">
          <div>
            <strong>Pipeline</strong>
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
            <div className="pipeline-brand">
              <RhoLogo className="pipeline-brand-logo" />
              <RhoMark className="pipeline-brand-mark" />
              <span className="pipeline-brand-product">PD Check</span>
            </div>
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
                      onClick={() => handleNavigate(step.id)}
                    >
                      <span className="pipeline-sidebar-title">{step.shortTitle}</span>
                      <span className="pipeline-sidebar-state">
                        {done ? "Done" : active ? "Current" : "Pending"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ol>
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
