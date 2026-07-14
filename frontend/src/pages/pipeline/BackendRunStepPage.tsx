import { useCallback, useMemo, useState } from "react";
import { PipelineStepPage } from "../../components/pipeline/PipelineStepPage";
import { deploymentForStep } from "../../hooks/useStudySettings";
import type { StudySettings } from "../../hooks/useStudySettings";
import { usePipelineRunState } from "../../hooks/usePipelineRunState";
import {
  runStep,
  runStep1Extraction,
  type LlmProgress,
  type PipelineLogLine,
  type Step1RunStateResponse,
  type StepStatus
} from "../../services/stepApi";
import type { PipelineStepDef } from "../../pipeline/pipelineSteps";

interface BackendRunStepPageProps {
  studyId: string;
  step: PipelineStepDef;
  settings: StudySettings;
  defaultDeployment: string;
  backendStatuses: Record<string, StepStatus>;
  onStatusesChange: (statuses: Record<string, StepStatus>) => void;
  isRunActive: boolean;
  onRunActiveChange: (active: boolean) => void;
}

function logsForStep(logs: PipelineLogLine[], step: PipelineStepDef): PipelineLogLine[] {
  const tokens = [step.backendStepId, step.id, "extract-inputs", "Starting step", "[llm-text]", "llm:", "DI "];
  const filtered = logs.filter((line) => tokens.some((token) => token && line.text.includes(token)));
  return filtered.length > 0 ? filtered : logs;
}

export function BackendRunStepPage({
  studyId,
  step,
  settings,
  defaultDeployment,
  backendStatuses,
  onStatusesChange,
  isRunActive,
  onRunActiveChange
}: BackendRunStepPageProps): JSX.Element {
  const [localRunning, setLocalRunning] = useState(false);
  const poll = isRunActive || localRunning;
  const { runState } = usePipelineRunState(studyId, { enabled: poll, pollMs: 1500 });

  const isComplete = step.backendStepId ? backendStatuses[step.backendStepId] === "done" : false;
  const status = runState.status as "idle" | "running" | "done" | "failed";
  const isRunning = status === "running" || isRunActive || localRunning;
  const displayLogs = useMemo(() => logsForStep(runState.logs, step), [runState.logs, step]);

  const runOptions = useCallback(
    (force: boolean) => {
      const backendId = step.backendStepId ?? "";
      const deployment = deploymentForStep(backendId, settings, defaultDeployment);
      return {
        force,
        llmDeployment: deployment || undefined,
        llmInstructions: settings.extractionLlmInstructions.trim() || undefined
      };
    },
    [defaultDeployment, settings, step.backendStepId]
  );

  async function handleRun(force: boolean): Promise<void> {
    if (!studyId.trim()) {
      return;
    }
    if (
      force &&
      step.backendStepId === "extract-deviations" &&
      !window.confirm("Re-running will clear existing deviation extraction artifacts. Continue?")
    ) {
      return;
    }
    onRunActiveChange(true);
    setLocalRunning(true);
    try {
      if (step.id === "extract-pdfs") {
        const result = await runStep1Extraction(studyId.trim(), "document_intelligence", { force });
        onStatusesChange(result.stepStatuses);
      } else if (step.backendStepId) {
        const result = await runStep(studyId.trim(), step.backendStepId, runOptions(force));
        onStatusesChange(result.stepStatuses);
      }
    } finally {
      setLocalRunning(false);
      onRunActiveChange(false);
    }
  }

  const llmProgress: LlmProgress | null | undefined = runState.llmProgress;

  return (
    <PipelineStepPage
      title={step.title}
      description={step.description}
      status={status}
      isComplete={isComplete}
      canRun={Boolean(studyId.trim())}
      isRunning={isRunning}
      onRun={(force) => void handleRun(force)}
      logs={displayLogs}
      llmProgress={llmProgress ?? undefined}
      error={runState.error || undefined}
      message={runState.message || undefined}
    />
  );
}

export type { Step1RunStateResponse };
