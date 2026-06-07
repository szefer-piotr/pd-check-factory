import { useCallback, useEffect, useMemo, useState } from "react";
import { Page } from "../components/layout/Page";
import { Section } from "../components/layout/Section";
import { Stack } from "../components/layout/Stack";
import type { ProcessingSubProgressItem } from "../components/workflow/ProcessingPanel";
import { StudyPipelineView } from "../components/workflow/StudyPipelineView";
import { useStudyPipelineState } from "../hooks/useStudyPipelineState";
import { CodingPhasePanel } from "../components/workflow/CodingPhasePanel";
import { Step7ReviewPanel } from "../components/workflow/Step7ReviewPanel";
import { StepNavigation } from "../components/workflow/StepNavigation";
import type { StepRuntimeState } from "../components/workflow/StepNavigation";
import type { PipelineStepDefinition } from "../types/pipeline";
import {
  DEFAULT_STEP_ID,
  LEGACY_NAV_STEP_HASH_REDIRECT,
  NAV_PIPELINE_STEPS,
  PROCESSING_BACKEND_STEP_IDS
} from "../data/pipelineSteps";
import { useStudyDashboard } from "../hooks/useStudyDashboard";
import { useStudySettings } from "../hooks/useStudySettings";
import {
  acceptCodingPhase,
  deleteStudy,
  fetchOpenAiDeployments,
  fetchStepStatuses,
  fetchStudies,
  runStep,
  runStep1Extraction,
  setStep7ReviewDisplaySource,
  syncStudy,
  type OpenAiDeploymentOption,
  type Step1PdfExtractor,
  type StepStatus,
  type StudyOption
} from "../services/stepApi";
import { SettingsDrawer } from "../components/ui/SettingsDrawer";
import { StudySelector } from "../components/ui/StudySelector";
import { deriveNavStatuses } from "../utils/processingStatus";

const PROCESSING_SUB_STEPS: Array<{ stepId: (typeof PROCESSING_BACKEND_STEP_IDS)[number]; title: string }> = [
  { stepId: "extract-inputs", title: "Extract PDFs" },
  { stepId: "index-protocol", title: "Index protocol" },
  { stepId: "acrf-split-toc", title: "Split aCRF TOC" },
  { stepId: "acrf-summary-text", title: "Merge aCRF summary" },
  { stepId: "extract-rules", title: "Extract protocol rules" },
  { stepId: "extract-deviations", title: "Extract deviation candidates" }
];

const pipelineSteps = NAV_PIPELINE_STEPS;

function getStepIdFromHash(hash: string, steps: PipelineStepDefinition[]): string | null {
  const value = hash.replace("#", "").replace("/", "").trim();
  if (!value) {
    return null;
  }
  const redirected = LEGACY_NAV_STEP_HASH_REDIRECT[value];
  if (redirected) {
    return redirected;
  }
  return steps.some((step) => step.id === value) ? value : null;
}

function initialProcessingProgress(): ProcessingSubProgressItem[] {
  return PROCESSING_SUB_STEPS.map(({ stepId, title }) => ({
    stepId,
    title,
    status: "pending",
    message: "Waiting"
  }));
}

function runtimeFromNavStatuses(
  navStatuses: Record<string, StepStatus>,
  steps: PipelineStepDefinition[]
): Record<string, StepRuntimeState> {
  return Object.fromEntries(
    steps.map((step) => [
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
  const [codingPhaseAccepted, setCodingPhaseAccepted] = useState(false);
  const [activeStepId, setActiveStepId] = useState<string>(
    getStepIdFromHash(window.location.hash, pipelineSteps) ?? DEFAULT_STEP_ID
  );
  const [backendStatuses, setBackendStatuses] = useState<Record<string, StepStatus>>({});
  const [processingProgress, setProcessingProgress] = useState<ProcessingSubProgressItem[]>(initialProcessingProgress);
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingMessage, setProcessingMessage] = useState("");
  const [processingError, setProcessingError] = useState("");
  const [autoRunMessage, setAutoRunMessage] = useState("");
  const [runtimeStates, setRuntimeStates] = useState<Record<string, StepRuntimeState>>(
    runtimeFromNavStatuses(deriveNavStatuses({}), pipelineSteps)
  );
  const [studies, setStudies] = useState<StudyOption[]>([]);
  const [isLoadingStudies, setIsLoadingStudies] = useState(false);
  const [studyListError, setStudyListError] = useState("");
  const [isDeletingStudy, setIsDeletingStudy] = useState(false);
  const [deleteStudyMessage, setDeleteStudyMessage] = useState("");
  const [deleteStudyError, setDeleteStudyError] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [llmDeployments, setLlmDeployments] = useState<OpenAiDeploymentOption[]>([]);
  const [isLoadingDeployments, setIsLoadingDeployments] = useState(false);
  const { settings, updateSettings } = useStudySettings(studyId);
  const [isAcceptingCoding, setIsAcceptingCoding] = useState(false);
  const [codingAcceptError, setCodingAcceptError] = useState("");
  const [isPdSpecActionRunning, setIsPdSpecActionRunning] = useState(false);
  const [pdSpecActionMessage, setPdSpecActionMessage] = useState("");
  const [pdSpecActionError, setPdSpecActionError] = useState("");

  const navStatuses = useMemo(
    () => deriveNavStatuses(backendStatuses, { codingPhaseAccepted }),
    [backendStatuses, codingPhaseAccepted]
  );

  const applyBackendStatuses = useCallback(
    (statuses: Record<string, StepStatus>, codingAccepted?: boolean): void => {
      setBackendStatuses(statuses);
      const accepted = codingAccepted ?? codingPhaseAccepted;
      const nav = deriveNavStatuses(statuses, { codingPhaseAccepted: accepted });
      setRuntimeStates((previous) => {
        const next = runtimeFromNavStatuses(nav, pipelineSteps);
        for (const stepId of pipelineSteps.map((s) => s.id)) {
          const runtime = previous[stepId];
          if (runtime?.status === "running" || runtime?.status === "failed") {
            next[stepId] = runtime;
          }
        }
        return next;
      });
    },
    [codingPhaseAccepted]
  );

  const pipelineState = useStudyPipelineState(studyId, applyBackendStatuses);

  useEffect(() => {
    const onHashChange = (): void => {
      const hashStepId = getStepIdFromHash(window.location.hash, pipelineSteps);
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
    if (!pipelineSteps.some((step) => step.id === activeStepId)) {
      setActiveStepId(DEFAULT_STEP_ID);
      window.location.hash = `/${DEFAULT_STEP_ID}`;
    }
  }, [activeStepId]);

  useEffect(() => {
    async function loadStatuses(): Promise<void> {
      if (!studyId.trim()) {
        setBackendStatuses({});
        setCodingPhaseAccepted(false);
        return;
      }
      try {
        const status = await fetchStepStatuses(studyId.trim());
        const normalized = Object.fromEntries(status.steps.map((step) => [step.stepId, step.status])) as Record<
          string,
          StepStatus
        >;
        setCodingPhaseAccepted(Boolean(status.codingPhaseAccepted));
        applyBackendStatuses(normalized, Boolean(status.codingPhaseAccepted));
      } catch {
        // Keep default/past statuses when API is unavailable.
      }
    }

    void loadStatuses();
  }, [studyId, applyBackendStatuses]);

  const activeStep = useMemo(
    () => pipelineSteps.find((step) => step.id === activeStepId) ?? pipelineSteps[0],
    [activeStepId]
  );

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
    },
    [applyBackendStatuses, setStudyId, studyId]
  );

  useEffect(() => {
    void loadStudies();
  }, [loadStudies]);

  useEffect(() => {
    async function loadDeployments(): Promise<void> {
      setIsLoadingDeployments(true);
      try {
        const response = await fetchOpenAiDeployments();
        setLlmDeployments(response.deployments);
        const resolveDeployment = (previous: string): string =>
          previous && response.deployments.some((deployment) => deployment.id === previous)
            ? previous
            : response.defaultDeployment;
        updateSettings({
          extractionDeployment: resolveDeployment(settings.extractionDeployment),
          acrfSummaryDeployment: resolveDeployment(settings.acrfSummaryDeployment)
        });
      } catch {
        setLlmDeployments([]);
      } finally {
        setIsLoadingDeployments(false);
      }
    }

    void loadDeployments();
  }, []);

  function handleSelectStep(stepId: string): void {
    setActiveStepId(stepId);
    window.location.hash = `/${stepId}`;
    setCodingAcceptError("");
  }

  function handleStudyChange(nextStudyId: string): void {
    const trimmed = nextStudyId.trim();
    if (!trimmed) {
      return;
    }
    setStudyId(trimmed);
    const knownStudy = studies.find((study) => study.studyId === trimmed);
    setProcessingMessage("");
    setProcessingError("");
    setAutoRunMessage("");
    setPdSpecActionMessage("");
    setPdSpecActionError("");
    setCodingAcceptError("");
    if (!isProcessing) {
      setProcessingProgress(initialProcessingProgress());
    }
    pipelineState.resetForStudy();
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
          setCodingPhaseAccepted(Boolean(status.codingPhaseAccepted));
          applyBackendStatuses(normalized, Boolean(status.codingPhaseAccepted));
        })
        .catch(() => {
          // Keep empty statuses for new projects until API responds.
        });
    }
    void (async () => {
      try {
        await syncStudy(trimmed);
      } catch {
        // Best-effort: upload status still hydrates PD spec from blob when present.
      }
      await pipelineState.refreshUploadStatus(trimmed);
      await pipelineState.refreshRunState(trimmed);
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
      applyBackendStatuses({});
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

  async function handleRunProcessing(extractor: Step1PdfExtractor, forceReRun = false): Promise<void> {
    const trimmedStudyId = studyId.trim();
    if (!trimmedStudyId || isProcessing) {
      return;
    }

    setProcessingProgress(initialProcessingProgress());
    setProcessingMessage(forceReRun ? "Re-running extraction pipeline." : "Starting extraction pipeline.");
    setProcessingError("");
    setIsProcessing(true);
    setRuntimeStates((previous) => ({ ...previous, processing: { status: "running", message: "Running" } }));
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
        const alreadyDone =
          !forceReRun && (stepStatuses[stepId] === "done" || stepStatuses[stepId] === "skipped");
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
          applyBackendStatuses(stepStatuses);
          summary = extract.message;
        } else {
          const runOpts =
            stepId === "extract-rules" || stepId === "extract-deviations"
              ? {
                  llmInstructions: settings.extractionLlmInstructions,
                  llmDeployment: settings.extractionDeployment || undefined,
                  force: forceReRun
                }
              : stepId === "acrf-summary-text"
                ? {
                    llmDeployment: settings.acrfSummaryDeployment || undefined,
                    force: forceReRun
                  }
                : { force: forceReRun };
          const response = await runStep(trimmedStudyId, stepId, runOpts);
          stepStatuses = response.stepStatuses;
          applyBackendStatuses(stepStatuses);
          summary = response.summary;
        }

        setProcessingProgress((previous) =>
          previous.map((item) => (item.stepId === stepId ? { ...item, status: "done", message: summary } : item))
        );
        await pipelineState.refreshRunState();
      }

      const status = await fetchStepStatuses(trimmedStudyId);
      const normalized = Object.fromEntries(status.steps.map((step) => [step.stepId, step.status])) as Record<string, StepStatus>;
      setCodingPhaseAccepted(Boolean(status.codingPhaseAccepted));
      applyBackendStatuses(normalized, Boolean(status.codingPhaseAccepted));
      setRuntimeStates((previous) => ({ ...previous, processing: { status: "done", message: "Done" } }));
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
      setRuntimeStates((previous) => ({ ...previous, processing: { status: "failed", message } }));
      pipelineState.setExtraction({ status: "failed", error: message });
      await pipelineState.refreshRunState();
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
    handleSelectStep("processing");
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
      applyBackendStatuses(response.stepStatuses);
      await setStep7ReviewDisplaySource(trimmedStudyId, "imported_pd_spec");
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
    setPdSpecActionMessage("Running protocol enrichment (sequential LLM per deviation)…");
    setPdSpecActionError("");
    setIsPdSpecActionRunning(true);
    try {
      const response = await runStep(trimmedStudyId, "import-pd-spec-enrich", {
        llmDeployment: settings.extractionDeployment || undefined
      });
      applyBackendStatuses(response.stepStatuses);
      await setStep7ReviewDisplaySource(trimmedStudyId, "enriched_pd_spec");
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
      applyBackendStatuses(result.stepStatuses, true);
      handleSelectStep("coding");
    } catch (error) {
      setCodingAcceptError(error instanceof Error ? error.message : "Unable to continue to coding.");
    } finally {
      setIsAcceptingCoding(false);
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
              <button className="button button-ghost" type="button" onClick={() => void refresh()} disabled={isLoading}>
                {isLoading ? "Syncing…" : "Sync"}
              </button>
              <button
                className="button button-ghost settings-gear-button"
                type="button"
                aria-label="Pipeline settings"
                title="Pipeline settings"
                onClick={() => setSettingsOpen(true)}
              >
                ⚙
              </button>
            </div>
          </header>
        </Section>

        <SettingsDrawer
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          studyId={studyId}
          llmDeployments={llmDeployments}
          deploymentsLoading={isLoadingDeployments}
          extractorChoice={settings.extractorChoice}
          onExtractorChange={(value) => updateSettings({ extractorChoice: value })}
          extractionLlmInstructions={settings.extractionLlmInstructions}
          onExtractionLlmInstructionsChange={(value) => updateSettings({ extractionLlmInstructions: value })}
          extractionDeployment={settings.extractionDeployment}
          onExtractionDeploymentChange={(value) => updateSettings({ extractionDeployment: value })}
          acrfSummaryDeployment={settings.acrfSummaryDeployment}
          onAcrfSummaryDeploymentChange={(value) => updateSettings({ acrfSummaryDeployment: value })}
        />

        <Section className="section-flat workflow-tabs-section">
          <StepNavigation
            steps={pipelineSteps}
            activeStepId={activeStep.id}
            statuses={navStatuses}
            runtimeStates={runtimeStates}
            onSelectStep={handleSelectStep}
            variant="horizontal"
          />
        </Section>

        <div className="workflow-main">
          <div className="workflow-content">
            {activeStep.id !== "processing" && autoRunMessage ? <p className="step1-status">{autoRunMessage}</p> : null}
            {runtimeStates[activeStep.id]?.status === "running" ? (
              <p className="step1-status">Running {activeStep.title}…</p>
            ) : null}
            {runtimeStates[activeStep.id]?.status === "failed" ? (
              <p className="step1-error">{runtimeStates[activeStep.id]?.message}</p>
            ) : null}

            {activeStep.id === "processing" ? (
              <StudyPipelineView
                studyId={studyId}
                pipelineState={pipelineState}
                backendStatuses={backendStatuses}
                onStatusesChange={applyBackendStatuses}
                onRunFullPipeline={(extractor) => void handleRunProcessing(extractor, false)}
                onReRunPipeline={(extractor) => void handleRunProcessing(extractor, true)}
                onMapPdSpecToReview={handleMapPdSpecToReview}
                onEnrichPdSpecToReview={handleEnrichPdSpecToReview}
                onStudiesReload={() => void loadStudies()}
                processingProgress={processingProgress}
                isProcessing={isProcessing}
                isPdSpecActionRunning={isPdSpecActionRunning}
                processingMessage={processingMessage}
                processingError={processingError}
                pdSpecActionMessage={pdSpecActionMessage}
                pdSpecActionError={pdSpecActionError}
                extractorChoice={settings.extractorChoice}
              />
            ) : activeStep.id === "review-and-finalize" ? (
              <Step7ReviewPanel
                studyId={studyId}
                onStepStatusesChange={applyBackendStatuses}
                onAcceptAndContinue={() => void handleAcceptAndContinueToCoding()}
                isAcceptingCoding={isAcceptingCoding}
                codingAcceptError={codingAcceptError}
              />
            ) : activeStep.id === "coding" ? (
              <CodingPhasePanel studyId={studyId} />
            ) : null}
          </div>
        </div>
      </Stack>
    </Page>
  );
}
