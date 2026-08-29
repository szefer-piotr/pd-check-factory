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

  const hero = useMemo(() => {
    switch (section) {
      case "config":
        return {
          title: "Configuration",
          description: "Choose Azure OpenAI deployments used for extraction, aCRF summary, and chat."
        };
      case "processing":
        return {
          title: "Document extraction",
          description: "Upload protocol and aCRF documents, then run preprocessing."
        };
      case "study":
      default:
        return {
          title: "Study selection",
          description: "Start a new study or open an existing one from blob storage."
        };
    }
  }, [section]);

  function goToStage(stageId: StudySetupSection): void {
    navigateToPipelineStep("study-setup", { section: stageId, studyId: studyId.trim() || undefined });
  }

  function continueTarget(): StudySetupSection | "rules" | null {
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
      <header className="page-hero page-hero-row">
        <div>
          <h1>{hero.title}</h1>
          <p>{hero.description}</p>
        </div>
      </header>

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
            className="button button-primary study-setup-continue-btn"
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
                : "Continue to Rules"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
