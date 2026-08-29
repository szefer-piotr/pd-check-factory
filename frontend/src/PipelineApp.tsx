import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityPanel } from "./components/pipeline/ActivityPanel";
import { ToastStack } from "./components/pipeline/ToastStack";
import { CostAnalysisStepPage } from "./pages/pipeline/CostAnalysisStepPage";
import { DeviationsStepPage } from "./pages/pipeline/DeviationsStepPage";
import { RulesStepPage } from "./pages/pipeline/RulesStepPage";
import { StudySetupStepPage } from "./pages/pipeline/StudySetupStepPage";
import { usePipelineJobs, PipelineJobProvider } from "./jobs/PipelineJobContext";
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

export function PipelineWorkspace(): JSX.Element {
  const jobs = usePipelineJobs();
  const [route, setRoute] = useState(() => parsePipelineHash(window.location.hash));
  const [backendStatuses, setBackendStatuses] = useState<Record<string, StepStatus>>({});
  const [processingComplete, setProcessingComplete] = useState(false);
  const [llmDeployments, setLlmDeployments] = useState<OpenAiDeploymentOption[]>([]);
  const [defaultDeployment, setDefaultDeployment] = useState("");
  const [deploymentsLoading, setDeploymentsLoading] = useState(true);
  const [resetError, setResetError] = useState("");
  const [resetMessage, setResetMessage] = useState("");

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

  const handleNavigate = useCallback(
    (stepId: PipelineStepId, options: { section?: StudySetupSection } = {}): void => {
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
    },
    [canNavigateTo, studyId]
  );

  const { setNav, registerResetHandler, setArtifactVersions, openInspector } = jobs;

  useEffect(() => {
    setNav({
      stepId: route.stepId,
      section: route.section ?? "study",
      studySelected: Boolean(studyId.trim()),
      configSaved: hasAppliedSettings,
      processingComplete,
      rulesDone: backendStatuses["extract-rules"] === "done",
      deviationsDone: backendStatuses["extract-deviations"] === "done",
      canNavigateTo,
      navigate: handleNavigate
    });
  }, [
    backendStatuses,
    canNavigateTo,
    handleNavigate,
    hasAppliedSettings,
    processingComplete,
    route.section,
    route.stepId,
    setNav,
    studyId
  ]);

  useEffect(() => {
    const runReset = async (): Promise<void> => {
      if (!studyId.trim()) {
        return;
      }
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
        throw resetErr;
      }
    };
    registerResetHandler(runReset);
    return () => registerResetHandler(null);
  }, [registerResetHandler, studyId]);

  useEffect(() => {
    if (route.stepId !== "rules" && route.stepId !== "deviations") {
      setArtifactVersions(null);
    }
  }, [route.stepId, setArtifactVersions]);

  useEffect(() => {
    if (route.stepId === "rules") {
      openInspector("protocol");
    } else if (route.stepId === "deviations") {
      openInspector("acrf");
    }
  }, [openInspector, route.stepId]);
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
    <div className="pipeline-workspace">
      <header className="pipeline-topbar">
        <div className="pipeline-topbar-left">
          <strong>Pipeline</strong>
          {studyId ? <span className="chip pipeline-topbar-study">{studyId}</span> : (
            <span className="pipeline-topbar-hint">No study selected</span>
          )}
        </div>
        <div className="pipeline-topbar-actions">
          <button
            type="button"
            className="button button-secondary"
            onClick={() => jobs.openInspector("protocol")}
          >
            Inspector
          </button>
          <button
            type="button"
            className={`button button-secondary ${jobs.isRunActive ? "pipeline-activity-trigger-live" : ""}`}
            onClick={() => jobs.openInspector("activity")}
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
            disabled={!studyId.trim()}
            onClick={() => void refreshStatuses()}
          >
            Refresh status
          </button>
        </div>
      </header>

      {resetError ? <p className="pipeline-error pipeline-global-message">{resetError}</p> : null}
      {resetMessage ? <p className="pipeline-message pipeline-global-message">{resetMessage}</p> : null}

      <main className="pipeline-main">{renderStep()}</main>

      {route.stepId !== "rules" && route.stepId !== "deviations" ? (
        <ActivityPanel
          variant="overlay"
          open={jobs.activityOpen}
          onClose={() => jobs.setActivityOpen(false)}
          tab={jobs.inspectorTab}
          onTabChange={jobs.setInspectorTab}
          studyId={studyId}
          protocolFocus={jobs.protocolFocus}
          acrfFocusHint={jobs.acrfFocusHint}
          artifactVersions={jobs.artifactVersions}
          isRunActive={jobs.isRunActive}
          activeJobLabel={jobs.activeJobLabel}
          queueLength={jobs.queueLength}
          logs={jobs.logs}
          llmProgress={jobs.llmProgress}
          runStateStatus={jobs.runStateStatus}
        />
      ) : null}
      <ToastStack toasts={jobs.toasts} onDismiss={jobs.dismissToast} />
    </div>
  );
}

/** Kept for existing imports/tests; App.tsx mounts AppShell + destination routing. */
export function PipelineApp(): JSX.Element {
  return (
    <PipelineJobProvider>
      <PipelineWorkspace />
    </PipelineJobProvider>
  );
}

export { pipelineHashForStep };
