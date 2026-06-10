import { useCallback, useEffect, useRef, useState } from "react";
import type { StudySettings } from "./useStudySettings";
import {
  fetchStep1RunState,
  fetchStepStatuses,
  runStep,
  runStep1Extraction,
  setStep7ReviewDisplaySource,
  syncStudy,
  type Step7ReviewSource,
  type StudyWorkflow
} from "../services/stepApi";
import { isWorkflowExtractionComplete } from "../utils/processingSteps";
import { runExtractionPipeline } from "../utils/runExtractionPipeline";

const PREPROCESS_SUB_STEPS = new Set(["preprocess-protocol", "preprocess-acrf"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function autoResumeStorageKey(studyId: string): string {
  return `pd-pipeline-auto-resume:${studyId.trim()}`;
}

function reviewSourceForWorkflow(workflow: StudyWorkflow): Step7ReviewSource {
  if (workflow === "map") {
    return "imported_pd_spec";
  }
  if (workflow === "enrich") {
    return "enriched_pd_spec";
  }
  return "generated";
}

export interface UsePipelineRunnerResult {
  isRunning: boolean;
  activeStepId: string | null;
  lastError: string;
  autoResumeEnabled: boolean;
  startPipeline: () => Promise<void>;
  runRemaining: () => Promise<void>;
  runSingleStep: (stepId: string, options?: { force?: boolean }) => Promise<void>;
  finalize: () => Promise<void>;
  clearError: () => void;
}

export function usePipelineRunner(
  studyId: string,
  workflow: StudyWorkflow | null | undefined,
  settings: StudySettings,
  refresh: () => Promise<void>
): UsePipelineRunnerResult {
  const [isRunning, setIsRunning] = useState(false);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);
  const [lastError, setLastError] = useState("");
  const [autoResumeEnabled, setAutoResumeEnabled] = useState(false);
  const runningRef = useRef(false);
  const autoResumeAttemptedRef = useRef(false);

  const clearError = useCallback(() => {
    setLastError("");
  }, []);

  const waitForPreprocessIdle = useCallback(async (trimmedStudyId: string): Promise<void> => {
    for (let attempt = 0; attempt < 120; attempt += 1) {
      const state = await fetchStep1RunState(trimmedStudyId);
      if (
        state.status === "running" &&
        PREPROCESS_SUB_STEPS.has(state.currentSubStepId)
      ) {
        await sleep(2000);
        continue;
      }
      return;
    }
  }, []);

  const runPipelineInternal = useCallback(
    async (options: { fromStepId?: string | null; force?: boolean; singleStepId?: string }) => {
      const trimmed = studyId.trim();
      if (!trimmed || !workflow || runningRef.current) {
        return;
      }

      runningRef.current = true;
      setIsRunning(true);
      setLastError("");

      try {
        await waitForPreprocessIdle(trimmed);

        if (options.singleStepId) {
          const stepId = options.singleStepId;
          setActiveStepId(stepId);
          if (stepId === "extract-inputs") {
            await runStep1Extraction(trimmed, {
              protocolExtractor: settings.protocolExtractor,
              acrfExtractor: settings.acrfExtractor,
              force: options.force
            });
          } else if (stepId === "review-and-finalize") {
            await runStep(trimmed, stepId, { force: options.force });
          } else {
            const runOpts =
              stepId === "extract-rules" || stepId === "extract-deviations"
                ? {
                    llmInstructions: settings.extractionLlmInstructions,
                    llmDeployment: settings.extractionDeployment || undefined,
                    force: options.force
                  }
                : stepId === "acrf-summary-text"
                  ? {
                      llmDeployment: settings.acrfSummaryDeployment || undefined,
                      force: options.force
                    }
                  : { force: options.force };
            await runStep(trimmed, stepId, runOpts);
          }
          await refresh();
          return;
        }

        if (workflow === "map") {
          setActiveStepId("import-pd-spec-map");
          await runStep(trimmed, "import-pd-spec-map", { force: options.force });
          await setStep7ReviewDisplaySource(trimmed, "imported_pd_spec");
        } else {
          await runExtractionPipeline({
            studyId: trimmed,
            workflow,
            protocolExtractor: settings.protocolExtractor,
            acrfExtractor: settings.acrfExtractor,
            extractionDeployment: settings.extractionDeployment || undefined,
            acrfSummaryDeployment: settings.acrfSummaryDeployment || undefined,
            extractionLlmInstructions: settings.extractionLlmInstructions,
            force: options.force,
            fromStepId: options.fromStepId ?? null,
            onStepStart: (stepId) => setActiveStepId(stepId),
            onStatusesChange: () => {
              void refresh();
            },
            shouldAbort: () => !runningRef.current
          });

          await setStep7ReviewDisplaySource(trimmed, reviewSourceForWorkflow(workflow));
        }

        await refresh();
        const statuses = await fetchStepStatuses(trimmed);
        const stepStatusMap = Object.fromEntries(
          statuses.steps.map((step) => [step.stepId, step.status])
        );
        if (isWorkflowExtractionComplete(workflow, stepStatusMap)) {
          setAutoResumeEnabled(false);
          sessionStorage.removeItem(autoResumeStorageKey(trimmed));
        }
      } catch (pipelineError) {
        const message =
          pipelineError instanceof Error ? pipelineError.message : "Pipeline run failed.";
        setLastError(message);
        throw pipelineError;
      } finally {
        runningRef.current = false;
        setIsRunning(false);
        setActiveStepId(null);
      }
    },
    [refresh, settings, studyId, waitForPreprocessIdle, workflow]
  );

  const startPipeline = useCallback(async () => {
    const trimmed = studyId.trim();
    if (!trimmed || !workflow || runningRef.current) {
      return;
    }
    setAutoResumeEnabled(true);
    sessionStorage.setItem(autoResumeStorageKey(trimmed), "1");
    await syncStudy(trimmed);
    await runPipelineInternal({ fromStepId: null, force: false });
  }, [runPipelineInternal, studyId, workflow]);

  const runRemaining = useCallback(async () => {
    const trimmed = studyId.trim();
    if (!trimmed || !workflow || runningRef.current) {
      return;
    }
    const statuses = await fetchStepStatuses(trimmed);
    const nextStepId = statuses.nextStepId;
    if (!nextStepId || nextStepId === "review-and-finalize") {
      if (workflow === "map" || workflow === "enrich" || workflow === "extract") {
        const stepStatusMap = Object.fromEntries(
          statuses.steps.map((step) => [step.stepId, step.status])
        );
        if (isWorkflowExtractionComplete(workflow, stepStatusMap)) {
          return;
        }
      }
      if (!nextStepId) {
        return;
      }
    }
    setAutoResumeEnabled(true);
    sessionStorage.setItem(autoResumeStorageKey(trimmed), "1");
    await runPipelineInternal({ fromStepId: nextStepId, force: false });
  }, [runPipelineInternal, studyId, workflow]);

  const runSingleStep = useCallback(
    async (stepId: string, options?: { force?: boolean }) => {
      await runPipelineInternal({
        singleStepId: stepId,
        force: options?.force ?? false
      });
    },
    [runPipelineInternal]
  );

  const finalize = useCallback(async () => {
    await runPipelineInternal({ singleStepId: "review-and-finalize", force: false });
  }, [runPipelineInternal]);

  useEffect(() => {
    const trimmed = studyId.trim();
    if (!trimmed || !workflow || runningRef.current) {
      return;
    }
    const shouldAutoResume =
      autoResumeEnabled || sessionStorage.getItem(autoResumeStorageKey(trimmed)) === "1";
    if (!shouldAutoResume || autoResumeAttemptedRef.current) {
      return;
    }

    let cancelled = false;
    const attemptAutoResume = async (): Promise<void> => {
      try {
        const [statuses, runState] = await Promise.all([
          fetchStepStatuses(trimmed),
          fetchStep1RunState(trimmed)
        ]);
        if (cancelled || runningRef.current) {
          return;
        }
        const stepStatusMap = Object.fromEntries(
          statuses.steps.map((step) => [step.stepId, step.status])
        );
        if (isWorkflowExtractionComplete(workflow, stepStatusMap)) {
          sessionStorage.removeItem(autoResumeStorageKey(trimmed));
          setAutoResumeEnabled(false);
          return;
        }
        if (runState.status === "running") {
          return;
        }
        if (!statuses.nextStepId || statuses.nextStepId === "review-and-finalize") {
          return;
        }
        autoResumeAttemptedRef.current = true;
        await runRemaining();
      } catch {
        // auto-resume is best-effort
      }
    };

    void attemptAutoResume();
    return () => {
      cancelled = true;
    };
  }, [autoResumeEnabled, runRemaining, studyId, workflow]);

  useEffect(() => {
    autoResumeAttemptedRef.current = false;
  }, [studyId]);

  return {
    isRunning,
    activeStepId,
    lastError,
    autoResumeEnabled,
    startPipeline,
    runRemaining,
    runSingleStep,
    finalize,
    clearError
  };
}
