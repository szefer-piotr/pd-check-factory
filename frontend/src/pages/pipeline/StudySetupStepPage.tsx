import { useEffect, useMemo, useRef } from "react";
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
  const studyRef = useRef<HTMLElement | null>(null);
  const configRef = useRef<HTMLElement | null>(null);
  const processingRef = useRef<HTMLElement | null>(null);

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
  const progressPercent = Math.round((completedCount / stages.length) * 100);

  useEffect(() => {
    const target =
      section === "config" ? configRef.current : section === "processing" ? processingRef.current : studyRef.current;
    target?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [section]);

  function goToStage(stageId: SetupStageId): void {
    navigateToPipelineStep("study-setup", { section: stageId, studyId: studyId.trim() || undefined });
  }

  return (
    <div className="pipeline-step-page study-setup-page">
      <header className="pipeline-step-header">
        <div>
          <h1>Study setup</h1>
          <p className="pipeline-step-description">
            Complete the three stages below before moving on to Generate PD. Progress stays available in the activity
            panel while you navigate.
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
        <div className="study-setup-progress-track" aria-hidden="true">
          <div className="study-setup-progress-fill" style={{ width: `${progressPercent}%` }} />
        </div>
        <ol className="study-setup-progress-stages">
          {stages.map((stage, index) => {
            const isCurrent = section === stage.id;
            const stateClass = stage.done ? "is-done" : isCurrent ? "is-current" : "is-pending";
            return (
              <li key={stage.id} className={`study-setup-progress-stage ${stateClass}`}>
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
                      {stage.done ? "Complete" : isCurrent ? "In progress" : "Not started"}
                    </span>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="study-setup-top-grid">
        <section
          ref={studyRef}
          id="study-setup-study"
          className={`study-setup-section ${studyDone ? "is-complete" : ""}`}
        >
          <StudyStepPage studyId={studyId} onStudyIdChange={onStudyIdChange} onCreated={onStudyCreated} />
        </section>

        <section
          ref={configRef}
          id="study-setup-config"
          className={`study-setup-section ${configDone ? "is-complete" : ""}`}
        >
          <ConfigStepPage
            settings={settings}
            onChange={onSettingsChange}
            onSave={onSaveConfig}
            saved={configSaved}
            deployments={deployments}
            deploymentsLoading={deploymentsLoading}
            defaultDeployment={defaultDeployment}
          />
        </section>
      </div>

      <section
        ref={processingRef}
        id="study-setup-processing"
        className={`study-setup-section study-setup-section-documents ${documentsDone ? "is-complete" : ""}`}
      >
        <ProcessingStepPage
          studyId={studyId}
          onStatusesChange={onStatusesChange}
          onProcessingCompleteChange={onProcessingCompleteChange}
          onRunActiveChange={onRunActiveChange}
          onRefreshSummary={onRefreshSummary}
          embedded
          hideLocalActivity
        />
      </section>
    </div>
  );
}
