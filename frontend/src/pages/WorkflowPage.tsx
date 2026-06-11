import { useCallback, useEffect, useMemo, useState } from "react";
import { Page } from "../components/layout/Page";
import { Section } from "../components/layout/Section";
import { Stack } from "../components/layout/Stack";
import type { ProcessingSubProgressItem } from "../components/workflow/ProcessingPanel";
import { StudyPipelineView } from "../components/workflow/StudyPipelineView";
import { useStudyPipelineState } from "../hooks/useStudyPipelineState";
import { StepNavigation, type StepNavInfo, type StepNavStatus } from "../components/workflow/StepNavigation";
import {
  DEFAULT_WORKFLOW_STEP_ID,
  LEGACY_WORKFLOW_HASH_REDIRECT,
  WORKFLOW_STEPS,
  workflowStepById,
  workflowStepIndex,
  type WorkflowStepDef
} from "../data/workflowSteps";
import { PROCESSING_BACKEND_STEP_IDS } from "../data/pipelineSteps";
import { useStudyDashboard } from "../hooks/useStudyDashboard";
import {
  acceptCodingPhase,
  deleteStudy,
  fetchStep1RunState,
  fetchStepStatuses,
  fetchStudies,
  runStep,
  runStep1Extraction,
  setStep7ReviewDisplaySource,
  syncStudy,
  type Step1PdfExtractor,
  type Step1RunStateResponse,
  type StepItemStatus,
  type StepStatus,
  type StepStatusesResponse,
  type StudyOption
} from "../services/stepApi";
import { StudySelector } from "../components/ui/StudySelector";
import { navigateToStep, parseHash } from "../utils/hashRoute";
import { UploadStepPage } from "./steps/UploadStepPage";
import { ExtractInputsStepPage } from "./steps/ExtractInputsStepPage";
import { IndexProtocolStepPage } from "./steps/IndexProtocolStepPage";
import { AcrfSplitTocStepPage } from "./steps/AcrfSplitTocStepPage";
import { AcrfSummaryStepPage } from "./steps/AcrfSummaryStepPage";
import { ExtractRulesStepPage } from "./steps/ExtractRulesStepPage";
import { ExtractDeviationsStepPage } from "./steps/ExtractDeviationsStepPage";
import { ReviewStepPage } from "./steps/ReviewStepPage";
import { CodingStepPage } from "./steps/CodingStepPage";
import type { WorkflowStepPageContext } from "./steps/common";

const PROCESSING_SUB_STEPS: Array<{ stepId: (typeof PROCESSING_BACKEND_STEP_IDS)[number]; title: string }> = [
  { stepId: "extract-inputs", title: "Extract PDFs" },
  { stepId: "index-protocol", title: "Index protocol" },
  { stepId: "acrf-split-toc", title: "Split aCRF TOC" },
  { stepId: "acrf-summary-text", title: "Merge aCRF summary" },
  { stepId: "extract-rules", title: "Extract protocol rules" },
  { stepId: "extract-deviations", title: "Extract deviation candidates" }
];

interface RouteState {
  stepId: string;
  focus?: string;
  tab?: string;
}

function routeFromHash(hash: string): RouteState {
  const { stepId, params } = parseHash(hash);
  const redirected = LEGACY_WORKFLOW_HASH_REDIRECT[stepId] ?? stepId;
  const known = WORKFLOW_STEPS.some((step) => step.id === redirected);
  return {
    stepId: known ? redirected : DEFAULT_WORKFLOW_STEP_ID,
    focus: params.get("focus") ?? undefined,
    tab: params.get("tab") ?? undefined
  };
}

function initialProcessingProgress(): ProcessingSubProgressItem[] {
  return PROCESSING_SUB_STEPS.map(({ stepId, title }) => ({
    stepId,
    title,
    status: "pending",
    message: "Waiting"
  }));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable;
}

export function WorkflowPage(): JSX.Element {
  const { studyId, setStudyId, data, isLoading, refresh } = useStudyDashboard("MY-STUDY");
  const [codingPhaseAccepted, setCodingPhaseAccepted] = useState(false);
  const [route, setRoute] = useState<RouteState>(() => routeFromHash(window.location.hash));
  const [backendStatuses, setBackendStatuses] = useState<Record<string, StepStatus>>({});
  const [statusItems, setStatusItems] = useState<Record<string, StepItemStatus>>({});
  const [entryMode, setEntryMode] = useState<string | undefined>(undefined);
  const [runState, setRunState] = useState<Step1RunStateResponse | null>(null);
  const [runningStepRouteId, setRunningStepRouteId] = useState<string | null>(null);
  const [stepRunErrors, setStepRunErrors] = useState<Record<string, string>>({});
  const [processingProgress, setProcessingProgress] = useState<ProcessingSubProgressItem[]>(initialProcessingProgress);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("");
  const [processingError, setProcessingError] = useState("");
  const [studies, setStudies] = useState<StudyOption[]>([]);
  const [isLoadingStudies, setIsLoadingStudies] = useState(false);
  const [studyListError, setStudyListError] = useState("");
  const [isDeletingStudy, setIsDeletingStudy] = useState(false);
  const [deleteStudyMessage, setDeleteStudyMessage] = useState("");
  const [deleteStudyError, setDeleteStudyError] = useState("");
  const [extractorChoice, setExtractorChoice] = useState<Step1PdfExtractor>("both");
  const [extractionLlmInstructions, setExtractionLlmInstructions] = useState("");
  const [isAcceptingCoding, setIsAcceptingCoding] = useState(false);
  const [codingAcceptError, setCodingAcceptError] = useState("");
  const [isPdSpecActionRunning, setIsPdSpecActionRunning] = useState(false);
  const [pdSpecActionMessage, setPdSpecActionMessage] = useState("");
  const [pdSpecActionError, setPdSpecActionError] = useState("");

  const activeStepId = route.stepId;
  const activeStep = workflowStepById(activeStepId) ?? WORKFLOW_STEPS[0];

  const applyStatusResponse = useCallback((status: StepStatusesResponse): void => {
    const normalized = Object.fromEntries(status.steps.map((step) => [step.stepId, step.status])) as Record<
      string,
      StepStatus
    >;
    setBackendStatuses(normalized);
    setStatusItems(Object.fromEntries(status.steps.map((step) => [step.stepId, step])));
    setCodingPhaseAccepted(Boolean(status.codingPhaseAccepted));
    setEntryMode(status.entryMode);
  }, []);

  const refreshStatuses = useCallback(
    async (overrideStudyId?: string): Promise<void> => {
      const trimmed = (overrideStudyId ?? studyId).trim();
      if (!trimmed) {
        setBackendStatuses({});
        setStatusItems({});
        setCodingPhaseAccepted(false);
        setEntryMode(undefined);
        return;
      }
      try {
        const status = await fetchStepStatuses(trimmed);
        applyStatusResponse(status);
      } catch {
        // Keep previous statuses when the API is unavailable.
      }
    },
    [studyId, applyStatusResponse]
  );

  /** Record-only status updates from child callbacks (counts refresh on the next full status load). */
  const applyBackendStatuses = useCallback((statuses: Record<string, StepStatus>): void => {
    setBackendStatuses(statuses);
  }, []);

  const pipelineState = useStudyPipelineState(studyId, applyBackendStatuses);

  const refreshRunStateRaw = useCallback(
    async (overrideStudyId?: string): Promise<void> => {
      const trimmed = (overrideStudyId ?? studyId).trim();
      if (!trimmed) {
        setRunState(null);
        return;
      }
      try {
        setRunState(await fetchStep1RunState(trimmed));
      } catch {
        // keep last known run state
      }
    },
    [studyId]
  );

  // Hash routing.
  useEffect(() => {
    const onHashChange = (): void => {
      setRoute(routeFromHash(window.location.hash));
    };
    window.addEventListener("hashchange", onHashChange);
    if (!window.location.hash) {
      window.location.hash = `/${DEFAULT_WORKFLOW_STEP_ID}`;
    }
    return () => {
      window.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  // Initial + per-study status load.
  useEffect(() => {
    void refreshStatuses();
    void refreshRunStateRaw();
  }, [refreshStatuses, refreshRunStateRaw]);

  const anyRunActive = isProcessing || runningStepRouteId !== null || runState?.status === "running";

  // Poll statuses + run state while any run is active.
  useEffect(() => {
    if (!anyRunActive || !studyId.trim()) {
      return;
    }
    const interval = setInterval(() => {
      void refreshStatuses();
      void refreshRunStateRaw();
    }, 3000);
    return () => clearInterval(interval);
  }, [anyRunActive, studyId, refreshStatuses, refreshRunStateRaw]);

  useEffect(() => {
    setExtractionLlmInstructions("");
  }, [activeStepId]);

  const loadStudies = useCallback(
    async (options?: { syncFirst?: boolean }): Promise<void> => {
      setIsLoadingStudies(true);
      setStudyListError("");
      try {
        if (options?.syncFirst) {
          const sid = studyId.trim();
          if (sid) {
            await syncStudy(sid);
          }
        }
        const response = await fetchStudies();
        setStudies(response.studies);
        const current = response.studies.find((study) => study.studyId === studyId.trim());
        if (current) {
          setBackendStatuses(current.stepStatuses);
        } else if (!studyId.trim() && response.studies.length > 0) {
          setStudyId(response.studies[0].studyId);
        }
      } catch (studyError) {
        setStudyListError(studyError instanceof Error ? studyError.message : "Unable to load blob projects.");
        setStudies([]);
      } finally {
        setIsLoadingStudies(false);
      }
    },
    [setStudyId, studyId]
  );

  useEffect(() => {
    void loadStudies();
  }, [loadStudies]);

  const handleSelectStep = useCallback((stepId: string): void => {
    navigateToStep(stepId);
    setCodingAcceptError("");
  }, []);

  // ← / → keyboard navigation between steps.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.altKey || event.ctrlKey || event.metaKey || isEditableTarget(event.target)) {
        return;
      }
      const index = workflowStepIndex(activeStepId);
      if (event.key === "ArrowLeft" && index > 0) {
        handleSelectStep(WORKFLOW_STEPS[index - 1].id);
      } else if (event.key === "ArrowRight" && index >= 0 && index < WORKFLOW_STEPS.length - 1) {
        handleSelectStep(WORKFLOW_STEPS[index + 1].id);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeStepId, handleSelectStep]);

  function handleStudyChange(nextStudyId: string): void {
    const trimmed = nextStudyId.trim();
    if (!trimmed) {
      return;
    }
    setStudyId(trimmed);
    setProcessingMessage("");
    setProcessingError("");
    setPdSpecActionMessage("");
    setPdSpecActionError("");
    setCodingAcceptError("");
    setStepRunErrors({});
    setRunState(null);
    if (!isProcessing) {
      setProcessingProgress(initialProcessingProgress());
    }
    pipelineState.resetForStudy();
    setBackendStatuses({});
    setStatusItems({});
    void refreshStatuses(trimmed);
    void (async () => {
      try {
        await syncStudy(trimmed);
      } catch {
        // Best-effort: upload status still hydrates PD spec from blob when present.
      }
      await pipelineState.refreshUploadStatus(trimmed);
      await pipelineState.refreshRunState(trimmed);
      await refreshRunStateRaw(trimmed);
    })();
    setDeleteStudyMessage("");
    setDeleteStudyError("");
  }

  async function handleDeleteStudy(): Promise<void> {
    const trimmed = studyId.trim();
    if (!trimmed || isDeletingStudy) {
      return;
    }
    const confirmed = window.confirm(
      `Delete study "${trimmed}"?\n\nThis permanently removes all blob files and local artifacts for this study. This cannot be undone.`
    );
    if (!confirmed) {
      return;
    }
    setIsDeletingStudy(true);
    setDeleteStudyMessage("");
    setDeleteStudyError("");
    try {
      const result = await deleteStudy(trimmed);
      sessionStorage.removeItem(`pd-pipeline:${trimmed}`);
      setDeleteStudyMessage(result.message);
      setStudies((previous) => previous.filter((study) => study.studyId !== trimmed));
      setBackendStatuses({});
      setStatusItems({});
      setCodingPhaseAccepted(false);
      pipelineState.resetForStudy();
      setStudyId("");
      setProcessingProgress(initialProcessingProgress());
      setProcessingMessage("");
      setProcessingError("");
      await loadStudies();
    } catch (deleteFailure) {
      setDeleteStudyError(deleteFailure instanceof Error ? deleteFailure.message : "Unable to delete study.");
    } finally {
      setIsDeletingStudy(false);
    }
  }

  /** Run a single backend step from its own page. */
  const handleRunSingleStep = useCallback(
    async (routeId: string, force: boolean): Promise<void> => {
      const stepDef = workflowStepById(routeId);
      const backendStepId = stepDef?.backendStepId;
      const trimmed = studyId.trim();
      if (!trimmed || !backendStepId || runningStepRouteId || isProcessing) {
        return;
      }
      setRunningStepRouteId(routeId);
      setStepRunErrors((previous) => ({ ...previous, [routeId]: "" }));
      try {
        if (backendStepId === "extract-inputs") {
          const result = await runStep1Extraction(trimmed, extractorChoice, { force });
          setBackendStatuses(result.stepStatuses);
        } else {
          const options =
            backendStepId === "extract-rules" || backendStepId === "extract-deviations"
              ? { llmInstructions: extractionLlmInstructions, force }
              : { force };
          const result = await runStep(trimmed, backendStepId, options);
          setBackendStatuses(result.stepStatuses);
        }
        await refreshStatuses();
      } catch (runFailure) {
        setStepRunErrors((previous) => ({
          ...previous,
          [routeId]: runFailure instanceof Error ? runFailure.message : "Step failed."
        }));
      } finally {
        setRunningStepRouteId(null);
        await refreshRunStateRaw();
      }
    },
    [studyId, runningStepRouteId, isProcessing, extractorChoice, extractionLlmInstructions, refreshStatuses, refreshRunStateRaw]
  );

  /** Sequential run-all used by the upload page tiles and the shell header button. */
  async function handleRunProcessing(extractor: Step1PdfExtractor, forceReRun = false): Promise<void> {
    const trimmedStudyId = studyId.trim();
    if (!trimmedStudyId || isProcessing || runningStepRouteId) {
      return;
    }

    setProcessingProgress(initialProcessingProgress());
    setProcessingMessage(forceReRun ? "Re-running extraction pipeline." : "Starting extraction pipeline.");
    setProcessingError("");
    setIsProcessing(true);
    pipelineState.setExtraction({
      status: "running",
      currentStage: "extract",
      currentSubStepId: "extract-inputs",
      message: "Extracting PDFs — please wait…",
      error: "",
      logs: []
    });

    try {
      let stepStatuses = { ...backendStatuses };
      for (const { stepId, title } of PROCESSING_SUB_STEPS) {
        const alreadyDone = !forceReRun && (stepStatuses[stepId] === "done" || stepStatuses[stepId] === "skipped");
        if (alreadyDone) {
          setProcessingProgress((previous) =>
            previous.map((item) =>
              item.stepId === stepId ? { ...item, status: "done", message: "Already complete" } : item
            )
          );
          continue;
        }

        const stageMap: Record<string, string> = {
          "extract-inputs": "extract",
          "index-protocol": "index",
          "acrf-split-toc": "acrf_split",
          "acrf-summary-text": "acrf_merge",
          "extract-rules": "rules",
          "extract-deviations": "deviations"
        };
        pipelineState.setExtraction({
          currentSubStepId: stepId,
          currentStage: stageMap[stepId] ?? stepId,
          message: `Running: ${title}…`
        });
        setProcessingProgress((previous) =>
          previous.map((item) => (item.stepId === stepId ? { ...item, status: "running", message: "Running" } : item))
        );

        let summary: string;
        if (stepId === "extract-inputs") {
          const extract = await runStep1Extraction(trimmedStudyId, extractor, { force: forceReRun });
          stepStatuses = extract.stepStatuses;
          setBackendStatuses(stepStatuses);
          summary = extract.message;
        } else {
          const runOpts =
            stepId === "extract-rules" || stepId === "extract-deviations"
              ? { llmInstructions: extractionLlmInstructions, force: forceReRun }
              : { force: forceReRun };
          const response = await runStep(trimmedStudyId, stepId, runOpts);
          stepStatuses = response.stepStatuses;
          setBackendStatuses(stepStatuses);
          summary = response.summary;
        }

        setProcessingProgress((previous) =>
          previous.map((item) => (item.stepId === stepId ? { ...item, status: "done", message: summary } : item))
        );
        await pipelineState.refreshRunState();
        await refreshRunStateRaw();
      }

      await refreshStatuses();
      setProcessingMessage("Processing completed. Opening review.");
      pipelineState.setExtraction({ status: "done", currentStage: "complete", message: "Processing completed." });
      handleSelectStep("review-and-finalize");
    } catch (processingFailure) {
      const message = processingFailure instanceof Error ? processingFailure.message : "Processing failed.";
      setProcessingError(message);
      setProcessingMessage("");
      setProcessingProgress((previous) =>
        previous.map((item) => (item.status === "running" ? { ...item, status: "failed", message } : item))
      );
      pipelineState.setExtraction({ status: "failed", error: message });
      await pipelineState.refreshRunState();
      await refreshRunStateRaw();
    } finally {
      setIsProcessing(false);
    }
  }

  async function handleNewStudy(): Promise<void> {
    const draft = window.prompt("Enter a new study ID:");
    if (!draft?.trim()) {
      return;
    }
    handleStudyChange(draft.trim());
    handleSelectStep("upload");
  }

  async function handleMapPdSpecToReview(): Promise<void> {
    const trimmedStudyId = studyId.trim();
    if (!trimmedStudyId || isPdSpecActionRunning) {
      return;
    }
    setPdSpecActionMessage("Mapping PD Specifications to review…");
    setPdSpecActionError("");
    setIsPdSpecActionRunning(true);
    try {
      const response = await runStep(trimmedStudyId, "import-pd-spec-map");
      setBackendStatuses(response.stepStatuses);
      await setStep7ReviewDisplaySource(trimmedStudyId, "imported_pd_spec");
      await refreshStatuses();
      setPdSpecActionMessage(response.summary);
      handleSelectStep("review-and-finalize");
    } catch (error) {
      setPdSpecActionError(error instanceof Error ? error.message : "Unable to map PD Specifications.");
      setPdSpecActionMessage("");
    } finally {
      setIsPdSpecActionRunning(false);
    }
  }

  async function handleEnrichPdSpecToReview(): Promise<void> {
    const trimmedStudyId = studyId.trim();
    if (!trimmedStudyId || isPdSpecActionRunning) {
      return;
    }
    setPdSpecActionMessage("Running protocol enrichment (parallel LLM analysis)…");
    setPdSpecActionError("");
    setIsPdSpecActionRunning(true);
    try {
      const response = await runStep(trimmedStudyId, "import-pd-spec-enrich");
      setBackendStatuses(response.stepStatuses);
      await setStep7ReviewDisplaySource(trimmedStudyId, "enriched_pd_spec");
      await refreshStatuses();
      setPdSpecActionMessage(response.summary);
      handleSelectStep("review-and-finalize");
    } catch (error) {
      setPdSpecActionError(error instanceof Error ? error.message : "Unable to enrich PD Specifications.");
      setPdSpecActionMessage("");
    } finally {
      setIsPdSpecActionRunning(false);
    }
  }

  async function handleAcceptAndContinueToCoding(): Promise<void> {
    const trimmed = studyId.trim();
    if (!trimmed || isAcceptingCoding) {
      return;
    }
    setCodingAcceptError("");
    setIsAcceptingCoding(true);
    try {
      const result = await acceptCodingPhase(trimmed);
      setCodingPhaseAccepted(true);
      setBackendStatuses(result.stepStatuses);
      handleSelectStep("coding");
    } catch (error) {
      setCodingAcceptError(error instanceof Error ? error.message : "Unable to continue to coding.");
    } finally {
      setIsAcceptingCoding(false);
    }
  }

  // -------- stepper infos --------

  const stepRunningFromRunState = (backendStepId: string | undefined): boolean =>
    Boolean(
      backendStepId &&
        runState?.status === "running" &&
        runState.currentSubStepId === backendStepId
    );

  const isStepRunningFor = (step: WorkflowStepDef): boolean =>
    runningStepRouteId === step.id ||
    stepRunningFromRunState(step.backendStepId) ||
    (isProcessing &&
      Boolean(step.backendStepId) &&
      processingProgress.some((item) => item.stepId === step.backendStepId && item.status === "running"));

  const stepInfos = useMemo<Record<string, StepNavInfo>>(() => {
    const infos: Record<string, StepNavInfo> = {};
    for (const step of WORKFLOW_STEPS) {
      let status: StepNavStatus = "pending";
      let subtitle: string | undefined;
      if (step.id === "upload") {
        status = pipelineState.pipeline.bothUploaded ? "done" : "pending";
        subtitle = pipelineState.pipeline.bothUploaded ? "2 PDFs" : undefined;
      } else if (step.id === "coding") {
        status = codingPhaseAccepted ? "done" : "pending";
      } else if (step.backendStepId) {
        const backendStatus = backendStatuses[step.backendStepId];
        status = backendStatus === "done" || backendStatus === "skipped" ? "done" : "pending";
        const item = statusItems[step.backendStepId];
        if (item?.count !== undefined && item.unit) {
          subtitle = `${item.count} ${item.unit}`;
        }
      }
      if (isStepRunningFor(step)) {
        status = "running";
        subtitle = "Running…";
      } else if (stepRunErrors[step.id]) {
        status = "failed";
      }
      infos[step.id] = { status, subtitle };
    }
    return infos;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    backendStatuses,
    statusItems,
    codingPhaseAccepted,
    pipelineState.pipeline.bothUploaded,
    runningStepRouteId,
    runState,
    isProcessing,
    processingProgress,
    stepRunErrors
  ]);

  // -------- per-page context --------

  const activeIndex = workflowStepIndex(activeStepId);
  const prevStep = activeIndex > 0 ? WORKFLOW_STEPS[activeIndex - 1] : undefined;
  const nextStep = activeIndex >= 0 && activeIndex < WORKFLOW_STEPS.length - 1 ? WORKFLOW_STEPS[activeIndex + 1] : undefined;

  const pageContextFor = (step: WorkflowStepDef): WorkflowStepPageContext => ({
    studyId,
    stepInfo: step.backendStepId ? statusItems[step.backendStepId] : undefined,
    backendStatuses,
    runState,
    isStepRunning: isStepRunningFor(step),
    runError: stepRunErrors[step.id] ?? "",
    onRun: (force: boolean) => void handleRunSingleStep(step.id, force),
    goPrev: prevStep ? () => handleSelectStep(prevStep.id) : undefined,
    goNext: nextStep ? () => handleSelectStep(nextStep.id) : undefined,
    prevLabel: prevStep?.shortTitle,
    nextLabel: nextStep?.shortTitle,
    focus: route.focus,
    tabParam: route.tab
  });

  const runAllRemaining = (
    <button
      className="button button-ghost"
      type="button"
      onClick={() => void handleRunProcessing(extractorChoice, false)}
      disabled={!studyId.trim() || isProcessing || runningStepRouteId !== null || !pipelineState.pipeline.bothUploaded}
      title="Run every remaining processing step in order"
    >
      {isProcessing ? "Running pipeline…" : "Run all remaining"}
    </button>
  );

  const uploadBody = (
    <StudyPipelineView
      studyId={studyId}
      pipelineState={pipelineState}
      backendStatuses={backendStatuses}
      onStatusesChange={applyBackendStatuses}
      onRunFullPipeline={(extractor) => handleRunProcessing(extractor, false)}
      onReRunPipeline={(extractor) => handleRunProcessing(extractor, true)}
      onMapPdSpecToReview={handleMapPdSpecToReview}
      onEnrichPdSpecToReview={handleEnrichPdSpecToReview}
      processingProgress={processingProgress}
      isProcessing={isProcessing}
      isPdSpecActionRunning={isPdSpecActionRunning}
      processingMessage={processingMessage}
      processingError={processingError}
      pdSpecActionMessage={pdSpecActionMessage}
      pdSpecActionError={pdSpecActionError}
      extractionLlmInstructions={extractionLlmInstructions}
      onExtractionLlmInstructionsChange={setExtractionLlmInstructions}
    />
  );

  function renderActivePage(): JSX.Element | null {
    const step = activeStep;
    switch (step.id) {
      case "upload":
        return (
          <UploadStepPage
            studyId={studyId}
            body={uploadBody}
            protocolUploaded={pipelineState.pipeline.uploads.protocol.status === "uploaded"}
            acrfUploaded={pipelineState.pipeline.uploads.acrf.status === "uploaded"}
            entryMode={entryMode}
            goNext={nextStep ? () => handleSelectStep(nextStep.id) : undefined}
            nextLabel={nextStep?.shortTitle}
            tabParam={route.tab}
          />
        );
      case "extract-inputs":
        return (
          <ExtractInputsStepPage
            {...pageContextFor(step)}
            extractorChoice={extractorChoice}
            onExtractorChange={setExtractorChoice}
            onRunExtraction={(force) => void handleRunSingleStep(step.id, force)}
          />
        );
      case "index-protocol":
        return <IndexProtocolStepPage {...pageContextFor(step)} />;
      case "acrf-split-toc":
        return <AcrfSplitTocStepPage {...pageContextFor(step)} />;
      case "acrf-summary-text":
        return <AcrfSummaryStepPage {...pageContextFor(step)} />;
      case "extract-rules":
        return (
          <ExtractRulesStepPage
            {...pageContextFor(step)}
            llmInstructions={extractionLlmInstructions}
            onLlmInstructionsChange={setExtractionLlmInstructions}
          />
        );
      case "extract-deviations":
        return (
          <ExtractDeviationsStepPage
            {...pageContextFor(step)}
            llmInstructions={extractionLlmInstructions}
            onLlmInstructionsChange={setExtractionLlmInstructions}
          />
        );
      case "review-and-finalize":
        return (
          <ReviewStepPage
            {...pageContextFor(step)}
            onStepStatusesChange={applyBackendStatuses}
            onAcceptAndContinue={() => void handleAcceptAndContinueToCoding()}
            isAcceptingCoding={isAcceptingCoding}
            codingAcceptError={codingAcceptError}
          />
        );
      case "coding":
        return (
          <CodingStepPage
            studyId={studyId}
            codingPhaseAccepted={codingPhaseAccepted}
            goPrev={prevStep ? () => handleSelectStep(prevStep.id) : undefined}
            prevLabel={prevStep?.shortTitle}
            tabParam={route.tab}
          />
        );
      default:
        return null;
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
              onNewStudy={handleNewStudy}
              onDeleteStudy={() => void handleDeleteStudy()}
              studies={studies}
              isLoading={isLoadingStudies}
              isDeleting={isDeletingStudy}
              error={studyListError || deleteStudyError}
              onReload={() => void loadStudies({ syncFirst: true })}
              showBlobPickerFirst
              blobPickerId="workflow-blob-project-picker"
            />
            {deleteStudyMessage ? <p className="step7-muted study-delete-message">{deleteStudyMessage}</p> : null}
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
              {runAllRemaining}
              <button className="button button-ghost" type="button" onClick={() => void refresh()} disabled={isLoading}>
                {isLoading ? "Syncing…" : "Sync"}
              </button>
            </div>
          </header>
        </Section>

        <Section className="section-flat workflow-tabs-section">
          <StepNavigation activeStepId={activeStepId} stepInfos={stepInfos} onSelectStep={handleSelectStep} />
        </Section>

        <div className="workflow-main">
          <div className="workflow-content">{renderActivePage()}</div>
        </div>
      </Stack>
    </Page>
  );
}
