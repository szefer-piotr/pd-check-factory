import { useCallback, useEffect, useMemo, useState } from "react";
import { Page } from "../components/layout/Page";
import { Section } from "../components/layout/Section";
import { Stack } from "../components/layout/Stack";
import { ProcessingPanel, type ProcessingSubProgressItem } from "../components/workflow/ProcessingPanel";
import { Step7ReviewPanel } from "../components/workflow/Step7ReviewPanel";
import { StepNavigation } from "../components/workflow/StepNavigation";
import type { StepRuntimeState } from "../components/workflow/StepNavigation";
import { StepPreview } from "../components/workflow/StepPreview";
import { StepRunPanel } from "../components/workflow/StepRunPanel";
import { DEFAULT_STEP_ID, PIPELINE_STEPS, PROCESSING_BACKEND_STEP_IDS } from "../data/pipelineSteps";
import { useStudyDashboard } from "../hooks/useStudyDashboard";
import {
  fetchStepPreview,
  fetchStepStatuses,
  fetchStudies,
  runStep,
  runStep1Extraction,
  type Step1PdfExtractor,
  type StepStatus,
  type StudyOption
} from "../services/stepApi";
import { StudySelector } from "../components/ui/StudySelector";
import { deriveNavStatuses } from "../utils/processingStatus";

type SubStepState = "pending" | "running" | "done" | "failed";

const REVIEW_AUTO_RUN_STEP_IDS = ["extract-rules", "extract-deviations"] as const;

const PROCESSING_SUB_STEPS: Array<{ stepId: (typeof PROCESSING_BACKEND_STEP_IDS)[number]; title: string }> = [
  { stepId: "extract-inputs", title: "Extract PDFs" },
  { stepId: "index-protocol", title: "Index protocol" },
  { stepId: "acrf-split-toc", title: "Split aCRF TOC" },
  { stepId: "acrf-summary-text", title: "Merge aCRF summary" }
];

function getStepIdFromHash(hash: string): string | null {
  const value = hash.replace("#", "").replace("/", "").trim();
  if (!value) {
    return null;
  }
  return PIPELINE_STEPS.some((step) => step.id === value) ? value : null;
}

function defaultNavStatuses(): Record<string, StepStatus> {
  return deriveNavStatuses({});
}

function initialProcessingProgress(): ProcessingSubProgressItem[] {
  return PROCESSING_SUB_STEPS.map(({ stepId, title }) => ({
    stepId,
    title,
    status: "pending",
    message: "Waiting"
  }));
}

function initialReviewAutoRunProgress(): Array<{ stepId: string; title: string; status: SubStepState; message: string }> {
  return REVIEW_AUTO_RUN_STEP_IDS.map((stepId) => {
    const step = PIPELINE_STEPS.find((candidate) => candidate.id === stepId);
    return {
      stepId,
      title: step?.title ?? stepId,
      status: "pending",
      message: "Waiting"
    };
  });
}

function runtimeFromNavStatuses(navStatuses: Record<string, StepStatus>): Record<string, StepRuntimeState> {
  return Object.fromEntries(
    PIPELINE_STEPS.map((step) => [
      step.id,
      {
        status: navStatuses[step.id] === "done" ? "done" : "pending",
        message: navStatuses[step.id] === "done" ? "Done" : "Pending"
      }
    ])
  ) as Record<string, StepRuntimeState>;
}

export function WorkflowPage(): JSX.Element {
  const { studyId, setStudyId, data, isLoading, refresh } = useStudyDashboard("MY-STUDY");
  const [activeStepId, setActiveStepId] = useState<string>(getStepIdFromHash(window.location.hash) ?? DEFAULT_STEP_ID);
  const [backendStatuses, setBackendStatuses] = useState<Record<string, StepStatus>>({});
  const [stepRunMessage, setStepRunMessage] = useState("");
  const [stepRunError, setStepRunError] = useState("");
  const [isRunningStep, setIsRunningStep] = useState(false);
  const [serverPreviewItems, setServerPreviewItems] = useState<Array<{ title: string; body: string; highlight?: boolean }>>([]);
  const [isNavCollapsed, setIsNavCollapsed] = useState(false);
  const [processingProgress, setProcessingProgress] = useState<ProcessingSubProgressItem[]>(initialProcessingProgress);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("");
  const [processingError, setProcessingError] = useState("");
  const [, setReviewAutoRunProgress] = useState(initialReviewAutoRunProgress);
  const [isAutoRunning, setIsAutoRunning] = useState(false);
  const [autoRunMessage, setAutoRunMessage] = useState("");
  const [autoRunError, setAutoRunError] = useState("");
  const [runtimeStates, setRuntimeStates] = useState<Record<string, StepRuntimeState>>(runtimeFromNavStatuses(defaultNavStatuses()));
  const [studies, setStudies] = useState<StudyOption[]>([]);
  const [isLoadingStudies, setIsLoadingStudies] = useState(false);
  const [studyListError, setStudyListError] = useState("");
  const [extractionLlmInstructions, setExtractionLlmInstructions] = useState("");

  const navStatuses = useMemo(() => deriveNavStatuses(backendStatuses), [backendStatuses]);

  const applyBackendStatuses = useCallback((statuses: Record<string, StepStatus>): void => {
    setBackendStatuses(statuses);
    const nav = deriveNavStatuses(statuses);
    setRuntimeStates((previous) => {
      const next = runtimeFromNavStatuses(nav);
      for (const stepId of PIPELINE_STEPS.map((s) => s.id)) {
        const runtime = previous[stepId];
        if (runtime?.status === "running" || runtime?.status === "failed") {
          next[stepId] = runtime;
        }
      }
      return next;
    });
  }, []);

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
        setBackendStatuses({});
        return;
      }
      try {
        const status = await fetchStepStatuses(studyId.trim());
        const normalized = Object.fromEntries(status.steps.map((step) => [step.stepId, step.status])) as Record<string, StepStatus>;
        applyBackendStatuses(normalized);
      } catch {
        // Keep default/past statuses when API is unavailable.
      }
    }

    void loadStatuses();
  }, [studyId, applyBackendStatuses]);

  useEffect(() => {
    async function loadPreview(): Promise<void> {
      if (!studyId.trim() || activeStepId === "processing" || activeStepId === "review-and-finalize") {
        setServerPreviewItems([]);
        return;
      }
      try {
        const preview = await fetchStepPreview(studyId.trim(), activeStepId);
        setServerPreviewItems(preview.previews);
        applyBackendStatuses(preview.stepStatuses);
      } catch {
        setServerPreviewItems([]);
      }
    }

    void loadPreview();
  }, [studyId, activeStepId, applyBackendStatuses]);

  const activeStep = useMemo(
    () => PIPELINE_STEPS.find((step) => step.id === activeStepId) ?? PIPELINE_STEPS[0],
    [activeStepId]
  );

  const canCollapseNav = activeStep.id === "review-and-finalize";
  const stepStatus = navStatuses[activeStep.id] ?? "pending";
  const hasRunStep = stepStatus === "done";

  const loadStudies = useCallback(async (): Promise<void> => {
    setIsLoadingStudies(true);
    setStudyListError("");
    try {
      const response = await fetchStudies();
      setStudies(response.studies);
      const current = response.studies.find((study) => study.studyId === studyId.trim());
      if (current) {
        applyBackendStatuses(current.stepStatuses);
      } else if (!studyId.trim() && response.studies.length > 0) {
        setStudyId(response.studies[0].studyId);
        applyBackendStatuses(response.studies[0].stepStatuses);
      }
    } catch (studyError) {
      setStudyListError(studyError instanceof Error ? studyError.message : "Unable to load blob projects.");
      setStudies([]);
    } finally {
      setIsLoadingStudies(false);
    }
  }, [applyBackendStatuses, setStudyId, studyId]);

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
    const trimmed = nextStudyId.trim();
    if (!trimmed) {
      return;
    }
    setStudyId(trimmed);
    const knownStudy = studies.find((study) => study.studyId === trimmed);
    if (knownStudy) {
      applyBackendStatuses(knownStudy.stepStatuses);
    } else {
      applyBackendStatuses({});
      void fetchStepStatuses(trimmed)
        .then((status) => {
          const normalized = Object.fromEntries(status.steps.map((step) => [step.stepId, step.status])) as Record<
            string,
            StepStatus
          >;
          applyBackendStatuses(normalized);
        })
        .catch(() => {
          // Keep empty statuses for new projects until API responds.
        });
    }
    setProcessingProgress(initialProcessingProgress());
    setReviewAutoRunProgress(initialReviewAutoRunProgress());
    setProcessingMessage("");
    setProcessingError("");
    setAutoRunMessage("");
    setAutoRunError("");
  }

  async function handleRunProcessing(extractor: Step1PdfExtractor): Promise<void> {
    const trimmedStudyId = studyId.trim();
    if (!trimmedStudyId || isProcessing) {
      return;
    }

    setProcessingProgress(initialProcessingProgress());
    setProcessingMessage("Starting processing.");
    setProcessingError("");
    setIsProcessing(true);
    setRuntimeStates((previous) => ({ ...previous, processing: { status: "running", message: "Running" } }));

    try {
      for (const { stepId } of PROCESSING_SUB_STEPS) {
        setProcessingProgress((previous) =>
          previous.map((item) => (item.stepId === stepId ? { ...item, status: "running", message: "Running" } : item))
        );

        let summary: string;
        if (stepId === "extract-inputs") {
          const extract = await runStep1Extraction(trimmedStudyId, extractor);
          applyBackendStatuses(extract.stepStatuses);
          summary = extract.message;
        } else {
          const response = await runStep(trimmedStudyId, stepId);
          applyBackendStatuses(response.stepStatuses);
          summary = response.summary;
        }

        setProcessingProgress((previous) =>
          previous.map((item) => (item.stepId === stepId ? { ...item, status: "done", message: summary } : item))
        );
      }

      const status = await fetchStepStatuses(trimmedStudyId);
      const normalized = Object.fromEntries(status.steps.map((step) => [step.stepId, step.status])) as Record<string, StepStatus>;
      applyBackendStatuses(normalized);
      setRuntimeStates((previous) => ({ ...previous, processing: { status: "done", message: "Done" } }));
      setProcessingMessage("Processing completed.");
    } catch (processingFailure) {
      const message = processingFailure instanceof Error ? processingFailure.message : "Processing failed.";
      setProcessingError(message);
      setProcessingMessage("");
      setProcessingProgress((previous) =>
        previous.map((item) => (item.status === "running" ? { ...item, status: "failed", message } : item))
      );
      setRuntimeStates((previous) => ({ ...previous, processing: { status: "failed", message } }));
      throw processingFailure;
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleRunCurrentStep(): Promise<void> {
    if (!studyId.trim() || activeStep.id === "processing") {
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
      applyBackendStatuses(response.stepStatuses);
      setRuntimeStates((previous) => ({
        ...previous,
        [activeStep.id]: { status: "done", message: response.summary }
      }));
      const preview = await fetchStepPreview(studyId.trim(), activeStep.id);
      setServerPreviewItems(preview.previews);
      applyBackendStatuses({ ...response.stepStatuses, ...preview.stepStatuses });
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

    setReviewAutoRunProgress(initialReviewAutoRunProgress());
    setAutoRunMessage("Starting automated run to DM revision.");
    setAutoRunError("");
    setStepRunMessage("");
    setStepRunError("");
    setIsAutoRunning(true);

    try {
      for (const stepId of REVIEW_AUTO_RUN_STEP_IDS) {
        setReviewAutoRunProgress((previous) =>
          previous.map((item) => (item.stepId === stepId ? { ...item, status: "running", message: "Running" } : item))
        );
        setRuntimeStates((previous) => ({ ...previous, [stepId]: { status: "running", message: "Running" } }));
        const response = await runStep(trimmedStudyId, stepId);
        applyBackendStatuses(response.stepStatuses);
        setReviewAutoRunProgress((previous) =>
          previous.map((item) => (item.stepId === stepId ? { ...item, status: "done", message: response.summary } : item))
        );
        setRuntimeStates((previous) => ({
          ...previous,
          [stepId]: { status: "done", message: response.summary }
        }));
      }

      const status = await fetchStepStatuses(trimmedStudyId);
      const normalized = Object.fromEntries(status.steps.map((step) => [step.stepId, step.status])) as Record<string, StepStatus>;
      applyBackendStatuses(normalized);
      setAutoRunMessage("Review is ready.");
      handleSelectStep("review-and-finalize");
    } catch (autoRunFailure) {
      const message = autoRunFailure instanceof Error ? autoRunFailure.message : "Automated run failed.";
      setAutoRunError(message);
      setAutoRunMessage("");
      setReviewAutoRunProgress((previous) =>
        previous.map((item) => (item.status === "running" ? { ...item, status: "failed", message } : item))
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
              statuses={navStatuses}
              runtimeStates={runtimeStates}
              onSelectStep={handleSelectStep}
            />
          </aside>
          <div className="workflow-content">
            {activeStep.id !== "processing" && autoRunMessage ? <p className="step1-status">{autoRunMessage}</p> : null}
            {runtimeStates[activeStep.id]?.status === "running" ? (
              <p className="step1-status">Running {activeStep.title}…</p>
            ) : null}
            {runtimeStates[activeStep.id]?.status === "failed" ? (
              <p className="step1-error">{runtimeStates[activeStep.id]?.message}</p>
            ) : null}

            {activeStep.id === "processing" ? (
              <ProcessingPanel
                studyId={studyId}
                backendStatuses={backendStatuses}
                onStatusesChange={applyBackendStatuses}
                onRunProcessing={handleRunProcessing}
                onRunToDmReview={handleAutoRunToDmReview}
                processingProgress={processingProgress}
                isProcessing={isProcessing}
                processingMessage={processingMessage}
                processingError={processingError}
                isAutoRunning={isAutoRunning}
                autoRunMessage={autoRunMessage}
                autoRunError={autoRunError}
              />
            ) : activeStep.id === "review-and-finalize" ? (
              <Step7ReviewPanel studyId={studyId} onStepStatusesChange={applyBackendStatuses} />
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
