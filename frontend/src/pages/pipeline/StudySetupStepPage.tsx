import { useMemo } from "react";
import { ConfigStepPage } from "./ConfigStepPage";
import { ProcessingStepPage } from "./ProcessingStepPage";
import { StudyStepPage } from "./StudyStepPage";
import type { StudySettings } from "../../hooks/useStudySettings";
import type { OpenAiDeploymentOption, StepStatus } from "../../services/stepApi";
import type { StudySetupSection } from "../../pipeline/pipelineSteps";
import { navigateToPipelineStep } from "../../pipeline/pipelineRoute";

interface StudySetupStepPageProps {
  studyId: string;
  onStudyIdChange: (value: string) => void;
  section?: StudySetupSection;
  settings: StudySettings;
  onSettingsChange: (patch: Partial<StudySettings>) => void;
  onSaveConfig: () => void;
  configSaved: boolean;
  processingComplete?: boolean;
  deployments: OpenAiDeploymentOption[];
  deploymentsLoading: boolean;
  defaultDeployment: string;
  onStatusesChange: (statuses: Record<string, StepStatus>) => void;
  onProcessingCompleteChange?: (complete: boolean) => void;
  onRunActiveChange?: (active: boolean) => void;
  onRefreshSummary?: () => Promise<void>;
  onStudyCreated: () => void;
}

type SetupStageId = StudySetupSection;

interface SetupStage {
  id: SetupStageId;
  label: string;
  shortLabel: string;
  done: boolean;
}

function stageStatusLabel(done: boolean, isCurrent: boolean): string {
  if (done) {
    return "Complete";
  }
  if (isCurrent) {
    return "In progress";
  }
  return "Not started";
}

export function StudySetupStepPage({
  studyId,
  onStudyIdChange,
  section = "study",
  settings,
  onSettingsChange,
  onSaveConfig,
  configSaved,
  processingComplete = false,
  deployments,
  deploymentsLoading,
  defaultDeployment,
  onStatusesChange,
  onProcessingCompleteChange,
  onRunActiveChange,
  onRefreshSummary,
  onStudyCreated
}: StudySetupStepPageProps): JSX.Element {
  const studyDone = Boolean(studyId.trim());
  const configDone = configSaved;
  const documentsDone = processingComplete;

  const stages = useMemo<SetupStage[]>(
    () => [
      { id: "study", label: "Study", shortLabel: "Study", done: studyDone },
      { id: "config", label: "Configuration", shortLabel: "Config", done: configDone },
      { id: "processing", label: "Document extraction", shortLabel: "Documents", done: documentsDone }
    ],
    [studyDone, configDone, documentsDone]
  );

  const completedCount = stages.filter((stage) => stage.done).length;
  const allComplete = completedCount === stages.length;

  const statusLine = stages
    .map((stage) => {
      if (stage.done) {
        return `${stage.shortLabel} ready`;
      }
      if (section === stage.id) {
        return `${stage.shortLabel} in progress`;
      }
      return `${stage.shortLabel} needed`;
    })
    .join(" · ");

  function goToStage(stageId: SetupStageId): void {
    navigateToPipelineStep("study-setup", { section: stageId, studyId: studyId.trim() || undefined });
  }

  function continueTarget(): SetupStageId | "rules" | null {
    if (section === "study" && studyDone) {
      return "config";
    }
    if (section === "config" && configDone) {
      return "processing";
    }
    if (section === "processing" && documentsDone) {
      return "rules";
    }
    return null;
  }

  const next = continueTarget();

  return (
    <div className="pipeline-step-page study-setup-page">
      <header className="pipeline-step-header">
        <div>
          <h1>Study setup</h1>
          <p className="pipeline-step-description">
            Complete each stage before moving on to Generate PD. Progress stays available in Activity while you
            navigate.
          </p>
        </div>
        <span
          className={`pipeline-step-badge ${allComplete ? "pipeline-step-badge-done" : ""}`}
          aria-live="polite"
        >
          {allComplete ? "Ready" : `${completedCount} of ${stages.length} complete`}
        </span>
      </header>

      <nav className="study-setup-progress" aria-label="Study setup stages">
        <ol className="study-setup-progress-stages">
          {stages.map((stage, index) => {
            const isCurrent = section === stage.id;
            const stateClass = stage.done ? "is-done" : isCurrent ? "is-current" : "is-pending";
            const previousDone = index > 0 && Boolean(stages[index - 1]?.done);
            const connectorDone = previousDone && stage.done;
            return (
              <li key={stage.id} className={`study-setup-progress-stage ${stateClass}`}>
                {index > 0 ? (
                  <span
                    className={`study-setup-progress-connector ${connectorDone ? "is-done" : ""}`}
                    aria-hidden="true"
                  />
                ) : null}
                <button
                  type="button"
                  className="study-setup-progress-button"
                  aria-current={isCurrent ? "step" : undefined}
                  onClick={() => goToStage(stage.id)}
                >
                  <span className="study-setup-progress-index" aria-hidden="true">
                    {stage.done ? "✓" : index + 1}
                  </span>
                  <span className="study-setup-progress-copy">
                    <span className="study-setup-progress-label">{stage.label}</span>
                    <span className="study-setup-progress-state">
                      {stageStatusLabel(stage.done, isCurrent)}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
        <p className="study-setup-progress-summary">{statusLine}</p>
      </nav>

      <section className="study-setup-section" aria-live="polite">
        {section === "study" ? (
          <StudyStepPage
            studyId={studyId}
            onStudyIdChange={onStudyIdChange}
            onCreated={onStudyCreated}
            embedded
          />
        ) : null}
        {section === "config" ? (
          <ConfigStepPage
            settings={settings}
            onChange={onSettingsChange}
            onSave={onSaveConfig}
            saved={configSaved}
            deployments={deployments}
            deploymentsLoading={deploymentsLoading}
            defaultDeployment={defaultDeployment}
            embedded
          />
        ) : null}
        {section === "processing" ? (
          <ProcessingStepPage
            studyId={studyId}
            onStatusesChange={onStatusesChange}
            onProcessingCompleteChange={onProcessingCompleteChange}
            onRunActiveChange={onRunActiveChange}
            onRefreshSummary={onRefreshSummary}
            embedded
            hideLocalActivity
          />
        ) : null}
      </section>

      {next ? (
        <div className="study-setup-continue pipeline-actions">
          <button
            type="button"
            className="button button-primary"
            onClick={() => {
              if (next === "rules") {
                navigateToPipelineStep("rules", { studyId: studyId.trim() || undefined });
                return;
              }
              goToStage(next);
            }}
          >
            {next === "config"
              ? "Continue to Configuration"
              : next === "processing"
                ? "Continue to Documents"
                : "Continue to Generate PD"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
