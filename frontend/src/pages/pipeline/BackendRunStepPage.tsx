import { useCallback, useEffect, useMemo, useState } from "react";
import { ArtifactVersionPicker } from "../../components/pipeline/ArtifactVersionPicker";
import { PipelineStepPage } from "../../components/pipeline/PipelineStepPage";
import { StepPreview } from "../../components/workflow/StepPreview";
import { deploymentForStep } from "../../hooks/useStudySettings";
import type { StudySettings } from "../../hooks/useStudySettings";
import { usePipelineRunState } from "../../hooks/usePipelineRunState";
import {
  fetchStepArtifactVersions,
  fetchStepPreview,
  runStep,
  runStep1Extraction,
  setActiveStepArtifact,
  VERSIONED_BACKEND_STEP_IDS,
  type LlmProgress,
  type Step1RunStateResponse,
  type StepArtifactVersionEntry,
  type StepPreviewResponse,
  type StepStatus
} from "../../services/stepApi";
import type { PipelineStepDef } from "../../pipeline/pipelineSteps";
import type { PipelinePreviewItem } from "../../types/pipeline";

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

const PREVIEW_STEP_IDS = new Set(["extract-rules", "extract-deviations", "acrf-summary"]);

function formatTimestamp(ts: string | undefined): string {
  if (!ts) {
    return "—";
  }
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return ts;
  }
}

function isVersionedStep(backendStepId: string | undefined): backendStepId is (typeof VERSIONED_BACKEND_STEP_IDS)[number] {
  return Boolean(
    backendStepId &&
      VERSIONED_BACKEND_STEP_IDS.includes(backendStepId as (typeof VERSIONED_BACKEND_STEP_IDS)[number])
  );
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
  const [localError, setLocalError] = useState("");
  const [preview, setPreview] = useState<StepPreviewResponse | null>(null);
  const [versions, setVersions] = useState<StepArtifactVersionEntry[]>([]);
  const [activeVersion, setActiveVersion] = useState<string | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);

  const poll = isRunActive || localRunning;
  const { runState } = usePipelineRunState(studyId, { enabled: poll, pollMs: 1500 });

  const isComplete = step.backendStepId ? backendStatuses[step.backendStepId] === "done" : false;
  const status = (localError ? "failed" : runState.status) as "idle" | "running" | "done" | "failed";
  const isRunning = status === "running" || isRunActive || localRunning;
  const showPreview = step.backendStepId && PREVIEW_STEP_IDS.has(step.id);
  const showVersionPicker = isVersionedStep(step.backendStepId);

  const refreshPreview = useCallback(async (): Promise<void> => {
    if (!studyId.trim() || !step.backendStepId || !showPreview) {
      setPreview(null);
      return;
    }
    try {
      const result = await fetchStepPreview(studyId.trim(), step.backendStepId, {
        version: activeVersion ?? undefined
      });
      setPreview(result);
    } catch {
      setPreview(null);
    }
  }, [activeVersion, showPreview, step.backendStepId, studyId]);

  const refreshVersions = useCallback(async (): Promise<void> => {
    if (!studyId.trim() || !showVersionPicker || !step.backendStepId) {
      setVersions([]);
      setActiveVersion(null);
      return;
    }
    try {
      const result = await fetchStepArtifactVersions(studyId.trim(), step.backendStepId);
      setVersions(result.versions);
      setActiveVersion(
        result.activeVersion ?? result.versions[result.versions.length - 1]?.version ?? null
      );
    } catch {
      setVersions([]);
    }
  }, [showVersionPicker, step.backendStepId, studyId]);

  useEffect(() => {
    void refreshVersions();
  }, [refreshVersions]);

  useEffect(() => {
    void refreshPreview();
  }, [refreshPreview]);

  const runOptions = useCallback(() => {
    const backendId = step.backendStepId ?? "";
    const deployment = deploymentForStep(backendId, settings, defaultDeployment);
    return {
      llmDeployment: deployment || undefined,
      llmInstructions: settings.extractionLlmInstructions.trim() || undefined
    };
  }, [defaultDeployment, settings, step.backendStepId]);

  async function handleRun(): Promise<void> {
    if (!studyId.trim()) {
      return;
    }
    onRunActiveChange(true);
    setLocalRunning(true);
    setLocalError("");
    try {
      if (step.id === "extract-pdfs") {
        const result = await runStep1Extraction(studyId.trim(), "document_intelligence", { force: true });
        onStatusesChange(result.stepStatuses);
      } else if (step.backendStepId) {
        const result = await runStep(studyId.trim(), step.backendStepId, runOptions());
        onStatusesChange(result.stepStatuses);
      }
      await refreshVersions();
      await refreshPreview();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setLocalError(message);
    } finally {
      setLocalRunning(false);
      onRunActiveChange(false);
    }
  }

  async function handleVersionSelect(version: string): Promise<void> {
    if (!studyId.trim() || !step.backendStepId || versionLoading) {
      return;
    }
    setVersionLoading(true);
    try {
      const result = await setActiveStepArtifact(studyId.trim(), step.backendStepId, version);
      onStatusesChange(result.stepStatuses);
      setActiveVersion(version);
      await refreshPreview();
      await refreshVersions();
    } finally {
      setVersionLoading(false);
    }
  }

  const llmProgress: LlmProgress | null | undefined = runState.llmProgress;

  const previewItems: PipelinePreviewItem[] = useMemo(
    () =>
      (preview?.previews ?? []).map((item) => ({
        title: item.title,
        body: item.body,
        highlight: item.highlight
      })),
    [preview?.previews]
  );

  const stepContent = (
    <>
      {showVersionPicker ? (
        <ArtifactVersionPicker
          stepId={step.backendStepId ?? ""}
          versions={versions}
          activeVersion={activeVersion}
          stepStatuses={backendStatuses}
          disabled={isRunning || versionLoading}
          onSelect={(version) => void handleVersionSelect(version)}
        />
      ) : null}

      {showPreview && previewItems.length > 0 ? (
        <>
          {preview?.generatedAt || preview?.version ? (
            <p className="artifact-timestamp-banner">
              Viewing artifacts from {formatTimestamp(preview.generatedAt)}
              {preview.version ? ` (${preview.version}` : ""}
              {preview.versionCreatedAt ? `, created ${formatTimestamp(preview.versionCreatedAt)}` : ""}
              {preview.version ? ")" : ""}
              {preview.itemCount ? ` — ${preview.itemCount} items` : ""}
            </p>
          ) : null}
          <StepPreview
            stepId={step.backendStepId ?? step.id}
            previews={previewItems}
            hasRun={isComplete}
          />
        </>
      ) : null}
    </>
  );

  return (
    <PipelineStepPage
      title={step.title}
      description={step.description}
      status={status}
      isComplete={isComplete}
      canRun={Boolean(studyId.trim())}
      isRunning={isRunning}
      onRun={() => void handleRun()}
      logs={runState.logs}
      llmProgress={llmProgress ?? undefined}
      error={localError || runState.error || undefined}
      message={runState.message || undefined}
    >
      {showVersionPicker || showPreview ? stepContent : null}
    </PipelineStepPage>
  );
}

export type { Step1RunStateResponse };
