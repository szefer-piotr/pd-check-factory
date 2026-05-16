import { useCallback, useEffect, useMemo, useState } from "react";
import { Page } from "../components/layout/Page";
import { Section } from "../components/layout/Section";
import { Stack } from "../components/layout/Stack";
import { Step1ExecutionPanel } from "../components/workflow/Step1ExecutionPanel";
import { Step7ReviewPanel } from "../components/workflow/Step7ReviewPanel";
import { StepNavigation } from "../components/workflow/StepNavigation";
import type { StepRuntimeState } from "../components/workflow/StepNavigation";
import { StepPreview } from "../components/workflow/StepPreview";
import { StepRunPanel } from "../components/workflow/StepRunPanel";
import { DEFAULT_STEP_ID, PIPELINE_STEPS } from "../data/pipelineSteps";
import { useStudyDashboard } from "../hooks/useStudyDashboard";
import { fetchStepPreview, fetchStepStatuses, fetchStudies, runStep, type StepStatus, type StudyOption } from "../services/stepApi";
import { StudySelector } from "../components/ui/StudySelector";

type AutoRunStepState = "pending" | "running" | "done" | "failed";

interface AutoRunProgressItem {
  stepId: string;
  title: string;
  status: AutoRunStepState;
  message: string;
}

const AUTO_RUN_STEP_IDS = ["index-protocol", "acrf-split-toc", "acrf-summary-text", "extract-rules", "extract-deviations"] as const;

function getStepIdFromHash(hash: string): string | null {
  const value = hash.replace("#", "").replace("/", "").trim();
  if (!value) {
    return null;
  }
  return PIPELINE_STEPS.some((step) => step.id === value) ? value : null;
}

function defaultStatuses(): Record<string, StepStatus> {
  return Object.fromEntries(PIPELINE_STEPS.map((step) => [step.id, "pending"])) as Record<string, StepStatus>;
}

function initialAutoRunProgress(): AutoRunProgressItem[] {
  return AUTO_RUN_STEP_IDS.map((stepId) => {
    const step = PIPELINE_STEPS.find((candidate) => candidate.id === stepId);
    return {
      stepId,
      title: step?.title ?? stepId,
      status: "pending",
      message: "Waiting"
    };
  });
}

function runtimeFromStatuses(statuses: Record<string, StepStatus>): Record<string, StepRuntimeState> {
  return Object.fromEntries(
    PIPELINE_STEPS.map((step) => [
      step.id,
      {
        status: statuses[step.id] === "done" ? "done" : "pending",
        message: statuses[step.id] === "done" ? "Done" : "Pending"
      }
    ])
  ) as Record<string, StepRuntimeState>;
}

export function WorkflowPage(): JSX.Element {
  const { studyId, setStudyId, data, isLoading, refresh } = useStudyDashboard("MY-STUDY");
  const [activeStepId, setActiveStepId] = useState<string>(getStepIdFromHash(window.location.hash) ?? DEFAULT_STEP_ID);
  const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>(defaultStatuses());
  const [stepRunMessage, setStepRunMessage] = useState("");
  const [stepRunError, setStepRunError] = useState("");
  const [isRunningStep, setIsRunningStep] = useState(false);
  const [serverPreviewItems, setServerPreviewItems] = useState<Array<{ title: string; body: string; highlight?: boolean }>>([]);
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
  const [autoRunProgress, setAutoRunProgress] = useState<AutoRunProgressItem[]>(initialAutoRunProgress);
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [autoRunMessage, setAutoRunMessage] = useState("");
  const [autoRunError, setAutoRunError] = useState("");
  const [runtimeStates, setRuntimeStates] = useState<Record<string, StepRuntimeState>>(runtimeFromStatuses(defaultStatuses()));
  const [studies, setStudies] = useState<StudyOption[]>([]);
  const [isLoadingStudies, setIsLoadingStudies] = useState(false);
  const [studyListError, setStudyListError] = useState("");
  const [extractionLlmInstructions, setExtractionLlmInstructions] = useState("");

  useEffect(() => {
    const onHashChange = (): void => {
      const hashStepId = getStepIdFromHash(window.location.hash);
      if (hashStepId) {
        setActiveStepId(hashStepId);
      }
    };

    window.addEventListener("hashchange", onHashChange);
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  useEffect(() => {
    async function loadStatuses(): Promise<void> {
      if (!studyId.trim()) {
        setStepStatuses(defaultStatuses());
        return;
      }
      try {
        const status = await fetchStepStatuses(studyId.trim());
        const normalized = Object.fromEntries(status.steps.map((step) => [step.stepId, step.status])) as Record<string, StepStatus>;
        setStepStatuses((previous) => ({ ...previous, ...normalized }));
        setRuntimeStates(runtimeFromStatuses({ ...defaultStatuses(), ...normalized }));
      } catch {
        // Keep default/past statuses when API is unavailable.
      }
    }

    void loadStatuses();
  }, [studyId]);

  useEffect(() => {
    async function loadPreview(): Promise<void> {
      if (!studyId.trim() || activeStepId === "extract-inputs" || activeStepId === "review-and-finalize") {
        setServerPreviewItems([]);
        return;
      }
      try {
        const preview = await fetchStepPreview(studyId.trim(), activeStepId);
        setServerPreviewItems(preview.previews);
        setStepStatuses((previous) => ({ ...previous, ...preview.stepStatuses }));
      } catch {
        setServerPreviewItems([]);
      }
    }

    void loadPreview();
  }, [studyId, activeStepId]);

  const activeStep = useMemo(
    () => PIPELINE_STEPS.find((step) => step.id === activeStepId) ?? PIPELINE_STEPS[0],
    [activeStepId]
  );

  const canCollapseNav = activeStep.id === "review-and-finalize";
  const stepStatus = stepStatuses[activeStep.id] ?? "pending";
  const hasRunStep = stepStatus === "done";

  const loadStudies = useCallback(async (): Promise<void> => {
    setIsLoadingStudies(true);
    setStudyListError("");
    try {
      const response = await fetchStudies();
      setStudies(response.studies);
      const current = response.studies.find((study) => study.studyId === studyId.trim());
      if (current) {
        setStepStatuses((previous) => ({ ...previous, ...current.stepStatuses }));
        setRuntimeStates(runtimeFromStatuses({ ...defaultStatuses(), ...current.stepStatuses }));
      } else if (!studyId.trim() && response.studies.length > 0) {
        setStudyId(response.studies[0].studyId);
        setStepStatuses((previous) => ({ ...previous, ...response.studies[0].stepStatuses }));
        setRuntimeStates(runtimeFromStatuses({ ...defaultStatuses(), ...response.studies[0].stepStatuses }));
      }
    } catch (studyError) {
      setStudyListError(studyError instanceof Error ? studyError.message : "Unable to load blob projects.");
      setStudies([]);
    } finally {
      setIsLoadingStudies(false);
    }
  }, [setStudyId, studyId]);

  useEffect(() => {
    setExtractionLlmInstructions("");
  }, [activeStepId]);

  useEffect(() => {
    void loadStudies();
  }, [loadStudies]);

  function handleSelectStep(stepId: string): void {
    setActiveStepId(stepId);
    window.location.hash = `/${stepId}`;
    setStepRunMessage("");
    setStepRunError("");
    if (stepId !== "review-and-finalize") {
      setIsNavCollapsed(false);
    }
  }

  function handleStudyChange(nextStudyId: string): void {
    setStudyId(nextStudyId);
    const knownStudy = studies.find((study) => study.studyId === nextStudyId);
    if (knownStudy) {
      setStepStatuses((previous) => ({ ...previous, ...knownStudy.stepStatuses }));
      setRuntimeStates(runtimeFromStatuses({ ...defaultStatuses(), ...knownStudy.stepStatuses }));
    }
    setAutoRunProgress(initialAutoRunProgress());
    setAutoRunMessage("");
    setAutoRunError("");
  }

  function moveToNextStep(): void {
    const currentIndex = PIPELINE_STEPS.findIndex((step) => step.id === activeStep.id);
    if (currentIndex >= 0 && currentIndex < PIPELINE_STEPS.length - 1) {
      handleSelectStep(PIPELINE_STEPS[currentIndex + 1].id);
    }
  }

  async function handleRunCurrentStep(): Promise<void> {
    if (!studyId.trim() || activeStep.id === "extract-inputs") {
      return;
    }
    setStepRunError("");
    setStepRunMessage("");
    setIsRunningStep(true);
    setRuntimeStates((previous) => ({ ...previous, [activeStep.id]: { status: "running", message: "Running" } }));
    try {
      const runOpts =
        activeStep.id === "extract-rules" || activeStep.id === "extract-deviations"
          ? { llmInstructions: extractionLlmInstructions }
          : undefined;
      const response = await runStep(studyId.trim(), activeStep.id, runOpts);
      setStepRunMessage(response.summary);
      setStepStatuses((previous) => ({ ...previous, ...response.stepStatuses }));
      setRuntimeStates({
        ...runtimeFromStatuses({ ...stepStatuses, ...response.stepStatuses }),
        [activeStep.id]: { status: "done", message: response.summary }
      });
      const preview = await fetchStepPreview(studyId.trim(), activeStep.id);
      setServerPreviewItems(preview.previews);
      setStepStatuses((previous) => ({ ...previous, ...preview.stepStatuses }));
    } catch (runError) {
      const message = runError instanceof Error ? runError.message : "Step run failed.";
      setStepRunError(message);
      setRuntimeStates((previous) => ({ ...previous, [activeStep.id]: { status: "failed", message } }));
    } finally {
      setIsRunningStep(false);
    }
  }

  async function handleAutoRunToDmReview(): Promise<void> {
    const trimmedStudyId = studyId.trim();
    if (!trimmedStudyId || isAutoRunning) {
      return;
    }

    setAutoRunProgress(initialAutoRunProgress());
    setAutoRunMessage("Starting automated run to DM revision.");
    setAutoRunError("");
    setStepRunMessage("");
    setStepRunError("");
    setIsAutoRunning(true);

    try {
      for (const stepId of AUTO_RUN_STEP_IDS) {
        setAutoRunProgress((previous) =>
          previous.map((item) =>
            item.stepId === stepId ? { ...item, status: "running", message: "Running" } : item
          )
        );
        setRuntimeStates((previous) => ({ ...previous, [stepId]: { status: "running", message: "Running" } }));
        const response = await runStep(trimmedStudyId, stepId);
        setStepStatuses((previous) => ({ ...previous, ...response.stepStatuses }));
        setAutoRunProgress((previous) =>
          previous.map((item) =>
            item.stepId === stepId ? { ...item, status: "done", message: response.summary } : item
          )
        );
        setRuntimeStates((previous) => ({
          ...previous,
          ...runtimeFromStatuses({ ...stepStatuses, ...response.stepStatuses }),
          [stepId]: { status: "done", message: response.summary }
        }));
      }

      const status = await fetchStepStatuses(trimmedStudyId);
      const normalized = Object.fromEntries(status.steps.map((step) => [step.stepId, step.status])) as Record<string, StepStatus>;
      setStepStatuses((previous) => ({ ...previous, ...normalized }));
      setRuntimeStates(runtimeFromStatuses({ ...defaultStatuses(), ...normalized }));
      setAutoRunMessage("Step 7 review is ready.");
      handleSelectStep("review-and-finalize");
    } catch (autoRunFailure) {
      const message = autoRunFailure instanceof Error ? autoRunFailure.message : "Automated run failed.";
      setAutoRunError(message);
      setAutoRunMessage("");
      setAutoRunProgress((previous) =>
        previous.map((item) =>
          item.status === "running" ? { ...item, status: "failed", message } : item
        )
      );
    } finally {
      setIsAutoRunning(false);
    }
  }

  return (
    <Page>
      <Stack gap="lg">
        <Section className="section-flat">
          <header className="hero hero-tight study-bar">
            <StudySelector
              value={studyId}
              onChange={handleStudyChange}
              studies={studies}
              isLoading={isLoadingStudies}
              error={studyListError}
              onReload={() => void loadStudies()}
            />
            <div className="study-chips">
              <span className="chip">
                Total <strong>{data?.overview.totalDeviations ?? "—"}</strong>
              </span>
              <span className="chip">
                Accepted <strong>{data?.overview.acceptedCount ?? "—"}</strong>
              </span>
              <span className="chip">
                To review <strong>{data?.overview.toReviewCount ?? "—"}</strong>
              </span>
              <button className="button button-ghost" type="button" onClick={() => void refresh()} disabled={isLoading}>
                {isLoading ? "Syncing…" : "Sync"}
              </button>
            </div>
          </header>
        </Section>

        <div
          className={`workflow-layout ${canCollapseNav ? "workflow-layout-step7" : ""} ${canCollapseNav && isNavCollapsed ? "workflow-layout-collapsed" : ""}`}
        >
          {canCollapseNav ? (
            <button
              className="button button-secondary workflow-nav-toggle"
              type="button"
              aria-label={isNavCollapsed ? "Show steps panel" : "Hide steps panel"}
              onClick={() => setIsNavCollapsed((current) => !current)}
            >
              {isNavCollapsed ? ">" : "<"}
            </button>
          ) : null}
          <aside className={`workflow-nav-shell ${canCollapseNav && isNavCollapsed ? "workflow-nav-shell-collapsed" : ""}`} aria-label="Steps panel">
            <StepNavigation
              steps={PIPELINE_STEPS}
              activeStepId={activeStep.id}
              statuses={stepStatuses}
              runtimeStates={runtimeStates}
              onSelectStep={handleSelectStep}
            />
          </aside>
          <div className="workflow-content">
            {activeStep.id !== "extract-inputs" && autoRunMessage ? <p className="step1-status">{autoRunMessage}</p> : null}
            {runtimeStates[activeStep.id]?.status === "running" ? (
              <p className="step1-status">Running {activeStep.title}…</p>
            ) : null}
            {runtimeStates[activeStep.id]?.status === "failed" ? (
              <p className="step1-error">{runtimeStates[activeStep.id]?.message}</p>
            ) : null}

            {activeStep.id === "extract-inputs" ? (
              <Step1ExecutionPanel
                studyId={studyId}
                onMoveNext={moveToNextStep}
                onStatusesChange={setStepStatuses}
                onRunToDmReview={handleAutoRunToDmReview}
                autoRunProgress={autoRunProgress}
                isAutoRunning={isAutoRunning}
                autoRunMessage={autoRunMessage}
                autoRunError={autoRunError}
              />
            ) : activeStep.id === "review-and-finalize" ? (
              <Step7ReviewPanel studyId={studyId} onStepStatusesChange={setStepStatuses} />
            ) : (
              <section className="workflow-panel">
                <StepRunPanel
                  stepTitle={activeStep.title}
                  stepId={activeStep.id}
                  stepStatus={stepStatus}
                  studyId={studyId}
                  isRunning={isRunningStep}
                  runMessage={stepRunMessage}
                  runError={stepRunError}
                  onRun={() => void handleRunCurrentStep()}
                  llmInstructions={extractionLlmInstructions}
                  onLlmInstructionsChange={setExtractionLlmInstructions}
                />
                <StepPreview stepId={activeStep.id} previews={serverPreviewItems} hasRun={hasRunStep} />
              </section>
            )}
          </div>
        </div>
      </Stack>
    </Page>
  );
}
