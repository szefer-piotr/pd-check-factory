import { useEffect, useMemo, useState } from "react";
import { Page } from "../components/layout/Page";
import { Section } from "../components/layout/Section";
import { Stack } from "../components/layout/Stack";
import { StepNavigation } from "../components/workflow/StepNavigation";
import { Step1ExecutionPanel } from "../components/workflow/Step1ExecutionPanel";
import { Step7ReviewPanel } from "../components/workflow/Step7ReviewPanel";
import { DEFAULT_STEP_ID, PIPELINE_STEPS } from "../data/pipelineSteps";
import { useStudyDashboard } from "../hooks/useStudyDashboard";
import { fetchStepPreview, fetchStepStatuses, runStep, type StepStatus } from "../services/stepApi";
import { StepDetailPage } from "./steps/StepDetailPage";
import { StudySelector } from "../components/ui/StudySelector";

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

export function WorkflowPage(): JSX.Element {
  const { studyId, setStudyId, data, isLoading, error, refresh } = useStudyDashboard("MY-STUDY");
  const [activeStepId, setActiveStepId] = useState<string>(getStepIdFromHash(window.location.hash) ?? DEFAULT_STEP_ID);
  const [stepStatuses, setStepStatuses] = useState<Record<string, StepStatus>>(defaultStatuses());
  const [stepRunMessage, setStepRunMessage] = useState("");
  const [stepRunError, setStepRunError] = useState("");
  const [isRunningStep, setIsRunningStep] = useState(false);
  const [serverPreviewItems, setServerPreviewItems] = useState<Array<{ title: string; body: string; highlight?: boolean }>>([]);
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);

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
      } catch {
        // Keep default/past statuses when API is unavailable.
      }
    }

    void loadStatuses();
  }, [studyId]);

  useEffect(() => {
    async function loadPreview(): Promise<void> {
      if (!studyId.trim() || activeStepId === "extract-inputs") {
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

  const activeStepWithPreview = useMemo(
    () => ({ ...activeStep, previewItems: serverPreviewItems.length > 0 ? serverPreviewItems : activeStep.previewItems }),
    [activeStep, serverPreviewItems]
  );
  const canCollapseNav = activeStep.id === "review-and-finalize";

  function handleSelectStep(stepId: string): void {
    setActiveStepId(stepId);
    window.location.hash = `/${stepId}`;
    setStepRunMessage("");
    setStepRunError("");
    if (stepId !== "review-and-finalize") {
      setIsNavCollapsed(false);
    }
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
    try {
      const response = await runStep(studyId.trim(), activeStep.id);
      setStepRunMessage(response.summary);
      setStepStatuses((previous) => ({ ...previous, ...response.stepStatuses }));
      const preview = await fetchStepPreview(studyId.trim(), activeStep.id);
      setServerPreviewItems(preview.previews);
      setStepStatuses((previous) => ({ ...previous, ...preview.stepStatuses }));
    } catch (runError) {
      setStepRunError(runError instanceof Error ? runError.message : "Step run failed.");
    } finally {
      setIsRunningStep(false);
    }
  }

  return (
    <Page>
      <Stack gap="lg">
        <Section>
          <header className="hero hero-tight">
            <div>
              <h1>PD Check Pipeline Pages</h1>
              <p>Each step has its own page with inputs, outputs, and previewed results.</p>
            </div>
            <button className="button" type="button" onClick={() => void refresh()} disabled={isLoading}>
              {isLoading ? "Syncing..." : "Sync study"}
            </button>
          </header>
        </Section>

        <Section title="Study Context">
          <div className="controls-row">
            <StudySelector value={studyId} onChange={setStudyId} />
            <div className="control-group">
              <span className="control-label">Study snapshot</span>
              <div className="inline-text">
                {error
                  ? error
                  : `total ${data?.overview.totalDeviations ?? "-"} | accepted ${data?.overview.acceptedCount ?? "-"} | to_review ${data?.overview.toReviewCount ?? "-"} | rejected ${data?.overview.rejectedCount ?? "-"}`}
              </div>
            </div>
          </div>
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
            <StepNavigation steps={PIPELINE_STEPS} activeStepId={activeStep.id} statuses={stepStatuses} onSelectStep={handleSelectStep} />
          </aside>
          <div className="workflow-content">
            {activeStep.id === "extract-inputs" ? (
              <Step1ExecutionPanel studyId={studyId} onMoveNext={moveToNextStep} onStatusesChange={setStepStatuses} />
            ) : activeStep.id === "review-and-finalize" ? (
              <Step7ReviewPanel studyId={studyId} onStepStatusesChange={setStepStatuses} />
            ) : (
              <section className="step1-panel" aria-label="Step execution">
                <h3>Run {activeStep.title}</h3>
                <p className="step1-subtitle">Execute this step against real backend pipeline artifacts.</p>
                <div className="step1-actions">
                  <button className="button" type="button" onClick={() => void handleRunCurrentStep()} disabled={isRunningStep || !studyId.trim()}>
                    {isRunningStep ? "Running..." : "Run this step"}
                  </button>
                </div>
                {stepRunMessage ? <p className="step1-status">{stepRunMessage}</p> : null}
                {stepRunError ? <p className="step1-error">{stepRunError}</p> : null}
              </section>
            )}
            <StepDetailPage step={activeStepWithPreview} />
          </div>
        </div>
      </Stack>
    </Page>
  );
}
