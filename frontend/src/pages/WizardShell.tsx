import { useCallback, useEffect, useMemo, useState } from "react";
import { Page } from "../components/layout/Page";
import { Section } from "../components/layout/Section";
import { STEPPER_STAGES, type WorkflowChoice } from "../data/wizardSteps";
import { useStudyPipelineState } from "../hooks/useStudyPipelineState";
import { applyDefaultDeployments, useStudySettings } from "../hooks/useStudySettings";
import { useStudySummary } from "../hooks/useStudySummary";
import {
  deleteStudy,
  fetchOpenAiDeployments,
  fetchStudies,
  fetchStudySummary,
  patchStudyManifest,
  type OpenAiDeploymentOption,
  type StepStatus,
  type StudyListItem,
  type WizardStage
} from "../services/stepApi";
import { isWorkflowComplete, uploadsReadyForWorkflow } from "../utils/workflowProgress";
import { navigateToWizardStage, parseWizardHash } from "../utils/wizardRoute";
import type { WizardStageId } from "../data/wizardSteps";
import { ProcessingPage } from "./wizard/ProcessingPage";
import { ProjectLibraryPage } from "./wizard/ProjectLibraryPage";
import { ProjectPage } from "./wizard/ProjectPage";
import { ReviewPage } from "./wizard/ReviewPage";
import { SetupPage } from "./wizard/SetupPage";
import { SummaryPage } from "./wizard/SummaryPage";
import { WelcomePage } from "./wizard/WelcomePage";

const STAGE_TO_ROUTE: Record<WizardStage, WizardStageId> = {
  project: "project",
  setup: "setup",
  summary: "summary",
  processing: "processing",
  review: "review"
};

export function WizardShell(): JSX.Element {
  const [stage, setStage] = useState<WizardStageId>(() => parseWizardHash(window.location.hash));
  const [studyId, setStudyId] = useState("");
  const [workflow, setWorkflow] = useState<WorkflowChoice | null>(null);
  const [createMode, setCreateMode] = useState(false);
  const [studies, setStudies] = useState<StudyListItem[]>([]);
  const [isLoadingStudies, setIsLoadingStudies] = useState(false);
  const [studyListError, setStudyListError] = useState("");
  const [backendStatuses, setBackendStatuses] = useState<Record<string, StepStatus>>({});
  const [llmDeployments, setLlmDeployments] = useState<OpenAiDeploymentOption[]>([]);
  const [defaultDeployment, setDefaultDeployment] = useState("");
  const [deploymentsLoading, setDeploymentsLoading] = useState(true);
  const [isDeletingStudy, setIsDeletingStudy] = useState(false);
  const [deleteStudyError, setDeleteStudyError] = useState("");
  const [isRunActive, setIsRunActive] = useState(false);

  const { settings, updateSettings } = useStudySettings(studyId);
  const effectiveSettings = useMemo(
    () => applyDefaultDeployments(settings, defaultDeployment),
    [settings, defaultDeployment]
  );

  const pollMs = isRunActive ? 3000 : 0;
  const { summary, isLoading: summaryLoading, refresh: refreshSummary } = useStudySummary(studyId, {
    enabled: Boolean(studyId.trim()) && stage !== "welcome" && stage !== "library",
    pollMs
  });

  const pipelineState = useStudyPipelineState(studyId, setBackendStatuses);

  useEffect(() => {
    const onHashChange = (): void => setStage(parseWizardHash(window.location.hash));
    window.addEventListener("hashchange", onHashChange);
    if (!window.location.hash || window.location.hash === "#" || window.location.hash === "#/") {
      navigateToWizardStage("welcome");
    }
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        setDeploymentsLoading(true);
        const response = await fetchOpenAiDeployments();
        setLlmDeployments(response.deployments);
        setDefaultDeployment(response.defaultDeployment);
      } catch {
        setLlmDeployments([]);
      } finally {
        setDeploymentsLoading(false);
      }
    })();
  }, []);

  useEffect(() => {
    if (summary) {
      setWorkflow(summary.workflow);
      setBackendStatuses(summary.stepStatuses);
    }
  }, [summary]);

  const loadStudies = useCallback(async (): Promise<void> => {
    setIsLoadingStudies(true);
    setStudyListError("");
    try {
      const response = await fetchStudies();
      setStudies(response.studies);
    } catch (err) {
      setStudyListError(err instanceof Error ? err.message : "Failed to load studies.");
    } finally {
      setIsLoadingStudies(false);
    }
  }, []);

  useEffect(() => {
    if (stage === "library") {
      void loadStudies();
    }
  }, [stage, loadStudies]);

  function goTo(stageId: WizardStageId): void {
    navigateToWizardStage(stageId);
    setStage(stageId);
    if (studyId.trim() && stageId !== "welcome" && stageId !== "library") {
      void patchStudyManifest(studyId.trim(), { uiStage: stageId as WizardStage }).catch(() => undefined);
    }
  }

  async function handleLibrarySelect(selectedId: string): Promise<void> {
    setStudyId(selectedId);
    try {
      const data = await fetchStudySummary(selectedId);
      setWorkflow(data.workflow);
      setBackendStatuses(data.stepStatuses);
      goTo(STAGE_TO_ROUTE[data.stage] ?? "project");
    } catch (err) {
      setStudyListError(err instanceof Error ? err.message : "Failed to open study.");
    }
  }

  async function handleWorkflowSelect(choice: WorkflowChoice): Promise<void> {
    if (!studyId.trim()) {
      return;
    }
    await patchStudyManifest(studyId.trim(), { workflowChoice: choice });
    setWorkflow(choice);
    await refreshSummary();
  }

  async function handleDeleteStudy(): Promise<void> {
    const trimmed = studyId.trim();
    if (!trimmed || isDeletingStudy) {
      return;
    }
    const confirmed = window.confirm(
      `Delete study "${trimmed}"?\n\nThis permanently removes all blob files and local artifacts.`
    );
    if (!confirmed) {
      return;
    }
    setIsDeletingStudy(true);
    setDeleteStudyError("");
    try {
      await deleteStudy(trimmed);
      setStudyId("");
      setWorkflow(null);
      setCreateMode(false);
      goTo("welcome");
    } catch (err) {
      setDeleteStudyError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setIsDeletingStudy(false);
    }
  }

  const canContinue = useMemo(() => {
    if (stage === "project") {
      return Boolean(studyId.trim() && workflow);
    }
    if (stage === "setup") {
      return uploadsReadyForWorkflow(
        workflow,
        summary?.bothUploaded ?? false,
        summary?.allThreeUploaded ?? false
      );
    }
    if (stage === "processing") {
      return isWorkflowComplete(workflow, summary?.stepStatuses ?? backendStatuses);
    }
    return true;
  }, [stage, studyId, workflow, summary]);

  function handleBack(): void {
    const order: WizardStageId[] = ["welcome", "library", "project", "setup", "summary", "processing", "review"];
    const index = order.indexOf(stage);
    if (index > 0) {
      goTo(order[index - 1]);
    }
  }

  function handleContinue(): void {
    if (stage === "welcome") {
      return;
    }
    if (stage === "project" && workflow) {
      goTo("setup");
      return;
    }
    if (stage === "setup") {
      goTo("summary");
      return;
    }
    if (stage === "summary") {
      goTo("processing");
      return;
    }
    if (stage === "processing") {
      goTo("review");
      return;
    }
  }

  const showStepper = stage !== "welcome" && stage !== "library";
  const stepperIndex = STEPPER_STAGES.findIndex((item) => item.id === stage);

  return (
    <Page>
      <header className="wizard-app-header">
        <div className="wizard-app-brand">
          <img className="wizard-logo wizard-logo-sm" src="/rho-logo-placeholder.svg" alt="" width={32} height={32} />
          <span className="wizard-app-title">Rho PD Assurance</span>
        </div>
        {studyId && stage !== "welcome" && stage !== "library" ? (
          <span className="wizard-study-chip">{studyId}</span>
        ) : null}
      </header>

      {showStepper ? (
        <Section className="section-flat wizard-stepper-section">
          <nav className="wizard-stepper" aria-label="Workflow progress">
            {STEPPER_STAGES.map((item, index) => (
              <button
                key={item.id}
                type="button"
                className={`wizard-stepper-item ${item.id === stage ? "wizard-stepper-item-active" : ""} ${index < stepperIndex ? "wizard-stepper-item-done" : ""}`}
                onClick={() => goTo(item.id)}
              >
                {item.shortTitle}
              </button>
            ))}
          </nav>
        </Section>
      ) : null}

      <Section>
        {stage === "welcome" ? (
          <WelcomePage
            onNewProject={() => {
              setStudyId("");
              setWorkflow(null);
              setCreateMode(true);
              goTo("project");
            }}
            onOpenLibrary={() => goTo("library")}
          />
        ) : null}

        {stage === "library" ? (
          <ProjectLibraryPage
            studies={studies}
            isLoading={isLoadingStudies}
            error={studyListError}
            onSelect={(id) => void handleLibrarySelect(id)}
            onReload={() => void loadStudies()}
          />
        ) : null}

        {stage === "project" ? (
          <ProjectPage
            studyId={studyId}
            selectedWorkflow={workflow}
            isCreating={false}
            createMode={createMode}
            onStudyCreated={(id) => {
              setStudyId(id);
              setCreateMode(false);
            }}
            onWorkflowSelect={(choice) => void handleWorkflowSelect(choice)}
            onDeleteStudy={studyId ? () => void handleDeleteStudy() : undefined}
            isDeleting={isDeletingStudy}
            deleteError={deleteStudyError}
          />
        ) : null}

        {stage === "setup" ? (
          <SetupPage
            studyId={studyId}
            workflow={workflow}
            pipelineState={pipelineState}
            backendStatuses={backendStatuses}
            onStatusesChange={setBackendStatuses}
            onStudiesReload={() => void refreshSummary()}
            settings={effectiveSettings}
            onSettingsChange={updateSettings}
            llmDeployments={llmDeployments}
            deploymentsLoading={deploymentsLoading}
          />
        ) : null}

        {stage === "summary" ? (
          <SummaryPage
            studyId={studyId}
            workflow={workflow}
            summary={summary}
            settings={effectiveSettings}
            isLoading={summaryLoading}
          />
        ) : null}

        {stage === "processing" ? (
          <ProcessingPage
            studyId={studyId}
            workflow={workflow}
            stepStatuses={backendStatuses}
            settings={effectiveSettings}
            defaultDeployment={defaultDeployment}
            onStatusesChange={setBackendStatuses}
            onRefreshSummary={refreshSummary}
            isRunActive={isRunActive}
            onRunActiveChange={setIsRunActive}
          />
        ) : null}

        {stage === "review" ? (
          <ReviewPage
            studyId={studyId}
            workflow={workflow}
            onStepStatusesChange={setBackendStatuses}
            llmDeployments={llmDeployments}
            deploymentsLoading={deploymentsLoading}
            chatDeployment={effectiveSettings.chatDeployment}
            onChatDeploymentChange={(value) => updateSettings({ chatDeployment: value })}
          />
        ) : null}
      </Section>

      {stage !== "welcome" ? (
        <footer className="wizard-footer">
          <button className="button button-secondary" type="button" onClick={handleBack}>
            Back
          </button>
          {stage === "summary" ? (
            <button className="button button-primary" type="button" onClick={() => goTo("processing")}>
              Start extraction
            </button>
          ) : stage === "processing" ? (
            <button
              className="button button-primary"
              type="button"
              onClick={handleContinue}
              disabled={!canContinue}
            >
              Continue to Review
            </button>
          ) : stage === "review" ? null : stage === "library" ? (
            <button className="button button-secondary" type="button" onClick={() => goTo("welcome")}>
              Back to Welcome
            </button>
          ) : (
            <button
              className="button button-primary"
              type="button"
              onClick={handleContinue}
              disabled={!canContinue}
            >
              Continue
            </button>
          )}
        </footer>
      ) : null}
    </Page>
  );
}
