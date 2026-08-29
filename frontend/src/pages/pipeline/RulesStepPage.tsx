import { useCallback, useEffect, useMemo, useState } from "react";
import { RulesWorkspace } from "../../components/workflow/RulesWorkspace";
import { deploymentForStep } from "../../hooks/useStudySettings";
import type { StudySettings } from "../../hooks/useStudySettings";
import { usePipelineJobs } from "../../jobs/PipelineJobContext";
import {
  fetchStepArtifactVersions,
  fetchStepPreview,
  setActiveStepArtifact,
  type StepArtifactVersionEntry,
  type StepPreviewResponse,
  type StepStatus
} from "../../services/stepApi";
import { extractRulesFromJson, type RulePreviewRow } from "../../utils/previewFormat";

interface RulesStepPageProps {
  studyId: string;
  settings: StudySettings;
  defaultDeployment: string;
  backendStatuses: Record<string, StepStatus>;
  onStatusesChange: (statuses: Record<string, StepStatus>) => void;
  chatDeployment: string;
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

function rulesFromPreview(preview: StepPreviewResponse | null): RulePreviewRow[] {
  const body = preview?.previews?.find((item) => item.title.toLowerCase().includes("rule"))?.body
    ?? preview?.previews?.[0]?.body;
  if (!body) {
    return [];
  }
  try {
    return extractRulesFromJson(JSON.parse(body));
  } catch {
    return [];
  }
}

export function RulesStepPage({
  studyId,
  settings,
  defaultDeployment,
  backendStatuses,
  onStatusesChange,
  chatDeployment
}: RulesStepPageProps): JSX.Element {
  const jobs = usePipelineJobs();
  const { setArtifactVersions, openInspector } = jobs;
  const backendStepId = "extract-rules" as const;

  const [localError, setLocalError] = useState("");
  const [preview, setPreview] = useState<StepPreviewResponse | null>(null);
  const [versions, setVersions] = useState<StepArtifactVersionEntry[]>([]);
  const [activeVersion, setActiveVersion] = useState<string | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [rulesChatKey, setRulesChatKey] = useState(0);

  const isComplete = backendStatuses[backendStepId] === "done";
  const isRunning = jobs.isRunActive;

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
  }, [activeVersion, studyId]);

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
  }, [studyId]);

  useEffect(() => {
    void refreshPreview();
    void refreshVersions();
  }, [refreshPreview, refreshVersions]);

  const handleVersionSelect = useCallback(
    async (version: string): Promise<void> => {
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
        setRulesChatKey((value) => value + 1);
      } finally {
        setVersionLoading(false);
      }
    },
    [onStatusesChange, refreshPreview, refreshVersions, studyId, versionLoading]
  );

  useEffect(() => {
    setArtifactVersions({
      stepId: backendStepId,
      versions,
      activeVersion,
      stepStatuses: backendStatuses,
      disabled: isRunning || versionLoading,
      onSelect: (version) => void handleVersionSelect(version)
    });
  }, [
    activeVersion,
    backendStatuses,
    handleVersionSelect,
    isRunning,
    setArtifactVersions,
    versionLoading,
    versions
  ]);

  async function handleRun(): Promise<void> {
    if (!studyId.trim() || isRunning) {
      return;
    }
    setLocalError("");
    try {
      const deployment = deploymentForStep(backendStepId, settings, defaultDeployment);
      const statuses = await jobs.runBackendStep(studyId.trim(), backendStepId, {
        llmDeployment: deployment || undefined,
        llmInstructions: settings.extractionLlmInstructions,
        versionMode: "new"
      });
      if (statuses) {
        onStatusesChange(statuses);
      }
      await refreshVersions();
      await refreshPreview();
      setRulesChatKey((value) => value + 1);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }

  const rules = useMemo(() => rulesFromPreview(preview), [preview]);

  return (
    <div className="pipeline-step-page generate-pd-page">
      <header className="page-hero page-hero-row">
        <div>
          <h1>Rules</h1>
          <p>Extract protocol rules, preview them in the list, and discuss edits with the assistant.</p>
        </div>
        <span
          className={`chip ${isRunning ? "chip-warning" : isComplete ? "chip-success" : ""}`}
        >
          {isRunning ? "Running" : isComplete ? "Complete" : "Pending"}
        </span>
      </header>

      <div className="generate-pd-main generate-pd-main-single">
        <div className="generate-pd-work">
          {localError ? <p className="pipeline-error">{localError}</p> : null}

          <div className="pipeline-step-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={!studyId.trim() || isRunning}
              onClick={() => void handleRun()}
            >
              {isComplete ? "Re-run" : "Run"} Rules
              {isRunning ? <span className="spinner spinner-sm" aria-hidden /> : null}
            </button>
            <button
              type="button"
              className="button button-secondary"
              onClick={() => openInspector("versions")}
            >
              Versions
            </button>
          </div>

          {isComplete ? (
            <>
              {preview?.generatedAt || preview?.version ? (
                <p className="artifact-timestamp-banner">
                  Viewing artifacts from {formatTimestamp(preview.generatedAt)}
                  {preview.version ? ` (${preview.version}` : ""}
                  {preview.versionCreatedAt ? `, created ${formatTimestamp(preview.versionCreatedAt)}` : ""}
                  {preview.version ? ")" : ""}
                </p>
              ) : null}
              <RulesWorkspace
                studyId={studyId}
                activeVersion={activeVersion}
                chatDeployment={chatDeployment}
                rules={rules}
                chatKey={rulesChatKey}
                onApplied={(statuses) => {
                  onStatusesChange(statuses);
                  void refreshVersions();
                  void refreshPreview();
                }}
              />
            </>
          ) : null}
        </div>
      </div>
    </div>
  );
}
