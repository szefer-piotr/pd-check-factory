import { useCallback, useEffect, useState } from "react";
import { Step7ReviewPanel } from "../../components/workflow/Step7ReviewPanel";
import { deploymentForStep } from "../../hooks/useStudySettings";
import type { StudySettings } from "../../hooks/useStudySettings";
import { usePipelineJobs } from "../../jobs/PipelineJobContext";
import {
  dedupeDeviationsPerRule,
  exportStep7DeviationsCodingCsv,
  fetchExtractDeviationsVersionPlan,
  fetchStepArtifactVersions,
  setActiveStepArtifact,
  setStep7ReviewDisplaySource,
  type Step7DeviationRow,
  type StepArtifactVersionEntry,
  type StepStatus
} from "../../services/stepApi";

interface DeviationsStepPageProps {
  studyId: string;
  settings: StudySettings;
  defaultDeployment: string;
  backendStatuses: Record<string, StepStatus>;
  onStatusesChange: (statuses: Record<string, StepStatus>) => void;
  chatDeployment: string;
}

export function DeviationsStepPage({
  studyId,
  settings,
  defaultDeployment,
  backendStatuses,
  onStatusesChange,
  chatDeployment
}: DeviationsStepPageProps): JSX.Element {
  const jobs = usePipelineJobs();
  const { setArtifactVersions, openInspector } = jobs;
  const backendStepId = "extract-deviations" as const;

  const [localError, setLocalError] = useState("");
  const [dedupeMessage, setDedupeMessage] = useState("");
  const [versions, setVersions] = useState<StepArtifactVersionEntry[]>([]);
  const [activeVersion, setActiveVersion] = useState<string | null>(null);
  const [versionLoading, setVersionLoading] = useState(false);
  const [versionChoice, setVersionChoice] = useState<{ matchingVersion: string } | null>(null);

  const [ready, setReady] = useState(false);
  const [rows, setRows] = useState<Step7DeviationRow[]>([]);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [exportMessage, setExportMessage] = useState("");
  const [reviewKey, setReviewKey] = useState(0);

  const isComplete = backendStatuses[backendStepId] === "done";
  const isRunning = jobs.isRunActive;
  const acceptedCount = rows.filter((row) => row.status === "accepted").length;

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
    void refreshVersions();
  }, [refreshVersions]);

  useEffect(() => {
    if (!studyId.trim() || !isComplete) {
      setReady(false);
      return;
    }
    let cancelled = false;
    setReady(false);
    void setStep7ReviewDisplaySource(studyId.trim(), "generated")
      .then(() => {
        if (!cancelled) {
          setReady(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setReady(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [studyId, isComplete, reviewKey]);

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
        await refreshVersions();
        setReviewKey((value) => value + 1);
      } finally {
        setVersionLoading(false);
      }
    },
    [onStatusesChange, refreshVersions, studyId, versionLoading]
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

  async function executeRun(versionMode: "new" | "overwrite", overwriteVersion?: string): Promise<void> {
    if (!studyId.trim()) {
      return;
    }
    setLocalError("");
    setDedupeMessage("");
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
      setReviewKey((value) => value + 1);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleRun(): Promise<void> {
    if (!studyId.trim() || isRunning) {
      return;
    }
    try {
      const plan = await fetchExtractDeviationsVersionPlan(studyId.trim());
      if (plan.matchingVersion) {
        setVersionChoice({ matchingVersion: plan.matchingVersion });
        return;
      }
    } catch {
      /* fall through to new version */
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
      const deployment = deploymentForStep(backendStepId, settings, defaultDeployment);
      const result = await dedupeDeviationsPerRule(studyId.trim(), {
        llmDeployment: deployment || undefined
      });
      onStatusesChange(result.stepStatuses);
      setDedupeMessage(
        `Deduped ${result.beforeCount} → ${result.afterCount} (removed ${result.removedCount}); wrote ${result.version}.`
      );
      await refreshVersions();
      setReviewKey((value) => value + 1);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : String(err));
    }
  }

  const handleRowsChange = useCallback((nextRows: Step7DeviationRow[]) => {
    setRows(nextRows);
  }, []);

  async function handleExport(): Promise<void> {
    if (!studyId.trim()) {
      return;
    }
    setExporting(true);
    setExportError("");
    setExportMessage("");
    try {
      const result = await exportStep7DeviationsCodingCsv(studyId.trim(), "generated");
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportMessage(
        `Downloaded ${result.fileName} (${acceptedCount} accepted deviation${acceptedCount === 1 ? "" : "s"}).`
      );
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Export failed.");
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="pipeline-step-page pipeline-review-page generate-pd-page">
      <header className="page-hero page-hero-row">
        <div>
          <h1>Deviations</h1>
          <p>Extract deviations, refine them with chat, then export the accepted set.</p>
        </div>
        <span className={`chip ${isRunning ? "chip-warning" : isComplete ? "chip-success" : ""}`}>
          {isRunning ? "Running" : isComplete ? "Complete" : "Pending"}
        </span>
      </header>

      <div className="generate-pd-main generate-pd-main-single">
        <div className="generate-pd-work">
          {localError ? <p className="pipeline-error">{localError}</p> : null}
          {dedupeMessage ? <p className="pipeline-message">{dedupeMessage}</p> : null}
          {exportError ? <p className="pipeline-error">{exportError}</p> : null}
          {exportMessage ? <p className="pipeline-message">{exportMessage}</p> : null}

          <div className="pipeline-step-actions">
            <button
              type="button"
              className="button button-primary"
              disabled={!studyId.trim() || isRunning}
              onClick={() => void handleRun()}
            >
              {isComplete ? "Re-run" : "Run"} Deviations
              {isRunning ? <span className="spinner spinner-sm" aria-hidden /> : null}
            </button>
            {isComplete ? (
              <button
                type="button"
                className="button button-secondary"
                disabled={isRunning}
                onClick={() => void handleDedupePerRule()}
              >
                Deduplicate (per rule)
              </button>
            ) : null}
            <button
              type="button"
              className="button button-secondary"
              onClick={() => openInspector("versions")}
            >
              Versions
            </button>
          </div>

          {isComplete ? (
            ready ? (
              <Step7ReviewPanel
                key={reviewKey}
                studyId={studyId}
                onStepStatusesChange={onStatusesChange}
                onRowsChange={handleRowsChange}
                chatDeployment={chatDeployment}
                hideSourceSelector
                minimal
                exportAcceptedCount={acceptedCount}
                exportTotalCount={rows.length}
                exporting={exporting}
                onExport={() => void handleExport()}
              />
            ) : (
              <p className="step7-muted">Loading review data…</p>
            )
          ) : null}
        </div>
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
