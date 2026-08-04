import { useCallback, useEffect, useMemo, useState } from "react";
import { ArtifactVersionPicker } from "../../components/pipeline/ArtifactVersionPicker";
import { RulesListChat } from "../../components/workflow/RulesListChat";
import { StepPreview } from "../../components/workflow/StepPreview";
import { deploymentForStep } from "../../hooks/useStudySettings";
import type { StudySettings } from "../../hooks/useStudySettings";
import { usePipelineJobs } from "../../jobs/PipelineJobContext";
import {
  dedupeDeviationsPerRule,
  fetchExtractDeviationsVersionPlan,
  fetchStepArtifactVersions,
  fetchStepPreview,
  setActiveStepArtifact,
  type OpenAiDeploymentOption,
  type StepArtifactVersionEntry,
  type StepPreviewResponse,
  type StepStatus
} from "../../services/stepApi";
import type { GeneratePdChildDef, GeneratePdSubStep } from "../../pipeline/pipelineSteps";
import { GENERATE_PD_CHILDREN } from "../../pipeline/pipelineSteps";
import type { PipelinePreviewItem } from "../../types/pipeline";

interface GeneratePdStepPageProps {
  studyId: string;
  subStep: GeneratePdSubStep;
  settings: StudySettings;
  defaultDeployment: string;
  backendStatuses: Record<string, StepStatus>;
  onStatusesChange: (statuses: Record<string, StepStatus>) => void;
  llmDeployments: OpenAiDeploymentOption[];
  deploymentsLoading: boolean;
  chatDeployment: string;
  onChatDeploymentChange: (value: string) => void;
  onSubStepChange: (subStep: GeneratePdSubStep) => void;
}

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

export function GeneratePdStepPage({
  studyId,
  subStep,
  settings,
  defaultDeployment,
  backendStatuses,
  onStatusesChange,
  llmDeployments,
  deploymentsLoading,
  chatDeployment,
  onChatDeploymentChange,
  onSubStepChange
}: GeneratePdStepPageProps): JSX.Element {
  const jobs = usePipelineJobs();
  const child: GeneratePdChildDef =
    GENERATE_PD_CHILDREN.find((item) => item.id === subStep) ?? GENERATE_PD_CHILDREN[0];
  const backendStepId = child.backendStepId;

  const [localError, setLocalError] = useState("");
  const [preview, setPreview] = useState<StepPreviewResponse | null>(null);
  const [versions, setVersions] = useState<StepArtifactVersionEntry[]>([]);
  const [activeVersion, setActiveVersion] = useState<string | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionChoice, setVersionChoice] = useState<{ matchingVersion: string } | null>(null);
  const [dedupeMessage, setDedupeMessage] = useState("");
  const [rulesChatKey, setRulesChatKey] = useState(0);

  const isComplete = backendStatuses[backendStepId] === "done";
  const isRunning = jobs.isRunActive;
  const isExtractDeviations = backendStepId === "extract-deviations";
  const isRules = backendStepId === "extract-rules";

  const refreshPreview = useCallback(async (): Promise<void> => {
    if (!studyId.trim()) {
      setPreview(null);
      return;
    }
    try {
      const result = await fetchStepPreview(studyId.trim(), backendStepId, {
        version: activeVersion ?? undefined
      });
      setPreview(result);
    } catch {
      setPreview(null);
    }
  }, [activeVersion, backendStepId, studyId]);

  const refreshVersions = useCallback(async (): Promise<void> => {
    if (!studyId.trim()) {
      setVersions([]);
      setActiveVersion(null);
      return;
    }
    try {
      const result = await fetchStepArtifactVersions(studyId.trim(), backendStepId);
      setVersions(result.versions);
      setActiveVersion(result.activeVersion ?? null);
    } catch {
      setVersions([]);
    }
  }, [backendStepId, studyId]);

  useEffect(() => {
    void refreshPreview();
    void refreshVersions();
  }, [refreshPreview, refreshVersions, subStep]);

  async function executeRun(versionMode: "new" | "overwrite", overwriteVersion?: string): Promise<void> {
    if (!studyId.trim()) {
      return;
    }
    setLocalError("");
    try {
      const deployment = deploymentForStep(backendStepId, settings, defaultDeployment);
      const statuses = await jobs.runBackendStep(studyId.trim(), backendStepId, {
        llmDeployment: deployment || undefined,
        llmInstructions: settings.extractionLlmInstructions,
        versionMode,
        overwriteVersion
      });
      if (statuses) {
        onStatusesChange(statuses);
      }
      await refreshVersions();
      await refreshPreview();
      if (isRules) {
        setRulesChatKey((value) => value + 1);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRun(): Promise<void> {
    if (!studyId.trim() || isRunning) {
      return;
    }
    if (isExtractDeviations) {
      try {
        const plan = await fetchExtractDeviationsVersionPlan(studyId.trim());
        if (plan.matchingVersion) {
          setVersionChoice({ matchingVersion: plan.matchingVersion });
          return;
        }
      } catch {
        /* fall through to new version */
      }
    }
    await executeRun("new");
  }

  async function handleDedupePerRule(): Promise<void> {
    if (!studyId.trim() || isRunning) {
      return;
    }
    if (
      !window.confirm(
        "Deduplicate deviations per rule?\n\nCreates a new deviations version from the active set. Prior versions remain available."
      )
    ) {
      return;
    }
    setLocalError("");
    setDedupeMessage("");
    try {
      const deployment = deploymentForStep("extract-deviations", settings, defaultDeployment);
      const result = await dedupeDeviationsPerRule(studyId.trim(), {
        llmDeployment: deployment || undefined
      });
      onStatusesChange(result.stepStatuses);
      setDedupeMessage(
        `Deduped ${result.beforeCount} → ${result.afterCount} (removed ${result.removedCount}); wrote ${result.version}.`
      );
      await refreshVersions();
      await refreshPreview();
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleVersionSelect(version: string): Promise<void> {
    if (!studyId.trim() || versionLoading) {
      return;
    }
    setVersionLoading(true);
    try {
      const result = await setActiveStepArtifact(studyId.trim(), backendStepId, version);
      onStatusesChange(result.stepStatuses);
      setActiveVersion(version);
      await refreshPreview();
      await refreshVersions();
      if (isRules) {
        setRulesChatKey((value) => value + 1);
      }
    } finally {
      setVersionLoading(false);
    }
  }

  const previewItems: PipelinePreviewItem[] = useMemo(
    () =>
      (preview?.previews ?? []).map((item) => ({
        title: item.title,
        body: item.body,
        highlight: item.highlight
      })),
    [preview?.previews]
  );

  return (
    <div className="pipeline-step-page generate-pd-page">
      <header className="pipeline-step-header">
        <div>
          <h1>Generate protocol deviations</h1>
          <p className="pipeline-step-description">
            Run Rules and Deviations manually. Use the activity panel to watch progress without blocking the app.
          </p>
        </div>
        <span className={`pipeline-step-badge pipeline-step-badge-${isRunning ? "running" : isComplete ? "done" : "idle"}`}>
          {isRunning ? "Running" : isComplete ? "Complete" : "Pending"}
        </span>
      </header>

      <div className="generate-pd-tabs" role="tablist" aria-label="Generate PD substeps">
        {GENERATE_PD_CHILDREN.map((item) => {
          const done = backendStatuses[item.backendStepId] === "done";
          const active = item.id === subStep;
          return (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={active}
              className={`button ${active ? "button-primary" : "button-secondary"} generate-pd-tab ${done ? "done" : ""}`}
              onClick={() => onSubStepChange(item.id)}
            >
              {item.shortTitle}
              <span className="generate-pd-tab-state">{done ? "Done" : "Pending"}</span>
            </button>
          );
        })}
      </div>

      <div className="generate-pd-main">
        <div className="generate-pd-work">
          <h2>{child.title}</h2>
          <p className="pipeline-step-description">{child.description}</p>

          {localError ? <p className="pipeline-error">{localError}</p> : null}
          {dedupeMessage ? <p className="pipeline-message">{dedupeMessage}</p> : null}

          <div className="pipeline-step-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={!studyId.trim() || isRunning}
              onClick={() => void handleRun()}
            >
              {isComplete ? "Re-run" : "Run"} {child.shortTitle}
              {isRunning ? <span className="spinner spinner-sm" aria-hidden /> : null}
            </button>
          </div>

          {isExtractDeviations && isComplete ? (
            <div className="pipeline-step-secondary-actions">
              <button
                type="button"
                className="button button-secondary"
                disabled={isRunning}
                onClick={() => void handleDedupePerRule()}
              >
                Deduplicate deviations (per rule)
              </button>
            </div>
          ) : null}

          {isRules && isComplete ? (
            <RulesListChat
              key={rulesChatKey}
              studyId={studyId}
              llmDeployments={llmDeployments}
              deploymentsLoading={deploymentsLoading}
              chatDeployment={chatDeployment}
              onChatDeploymentChange={onChatDeploymentChange}
              onApplied={(statuses) => {
                onStatusesChange(statuses);
                void refreshVersions();
                void refreshPreview();
              }}
            />
          ) : null}

          {previewItems.length > 0 ? (
            <>
              {preview?.generatedAt || preview?.version ? (
                <p className="artifact-timestamp-banner">
                  Viewing artifacts from {formatTimestamp(preview.generatedAt)}
                  {preview.version ? ` (${preview.version}` : ""}
                  {preview.versionCreatedAt ? `, created ${formatTimestamp(preview.versionCreatedAt)}` : ""}
                  {preview.version ? ")" : ""}
                </p>
              ) : null}
              <StepPreview
                stepId={backendStepId}
                previews={previewItems}
                hasRun={isComplete}
              />
            </>
          ) : null}
        </div>

        <aside className="generate-pd-chrome" aria-label="Artifact versions">
          <ArtifactVersionPicker
            stepId={backendStepId}
            versions={versions}
            activeVersion={activeVersion}
            stepStatuses={backendStatuses}
            disabled={isRunning || versionLoading}
            onSelect={(version) => void handleVersionSelect(version)}
          />
        </aside>
      </div>

      {versionChoice ? (
        <div className="version-choice-dialog" role="dialog" aria-modal="true" aria-labelledby="version-choice-title">
          <div className="version-choice-dialog-card">
            <h3 id="version-choice-title">Matching deviations version found</h3>
            <p>
              Sources match existing version <strong>{versionChoice.matchingVersion}</strong>. Overwrite it or create a
              new version?
            </p>
            <div className="version-choice-dialog-actions">
              <button
                type="button"
                className="button button-secondary"
                onClick={() => {
                  const matching = versionChoice.matchingVersion;
                  setVersionChoice(null);
                  void executeRun("overwrite", matching);
                }}
              >
                Overwrite {versionChoice.matchingVersion}
              </button>
              <button
                type="button"
                className="button button-primary"
                onClick={() => {
                  setVersionChoice(null);
                  void executeRun("new");
                }}
              >
                Create new version
              </button>
              <button type="button" className="button button-ghost" onClick={() => setVersionChoice(null)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
