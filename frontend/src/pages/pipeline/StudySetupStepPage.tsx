import { useEffect, useRef } from "react";
import { ConfigStepPage } from "./ConfigStepPage";
import { ProcessingStepPage } from "./ProcessingStepPage";
import { StudyStepPage } from "./StudyStepPage";
import type { StudySettings } from "../../hooks/useStudySettings";
import type { OpenAiDeploymentOption, StepStatus } from "../../services/stepApi";
import type { StudySetupSection } from "../../pipeline/pipelineSteps";

interface StudySetupStepPageProps {
  studyId: string;
  onStudyIdChange: (value: string) => void;
  section?: StudySetupSection;
  settings: StudySettings;
  onSettingsChange: (patch: Partial<StudySettings>) => void;
  onSaveConfig: () => void;
  configSaved: boolean;
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

  useEffect(() => {
    const target =
      section === "config" ? configRef.current : section === "processing" ? processingRef.current : studyRef.current;
    target?.scrollIntoView?.({ block: "start", behavior: "smooth" });
  }, [section]);

  return (
    <div className="pipeline-step-page study-setup-page">
      <header className="pipeline-step-header">
        <div>
          <h1>Study setup</h1>
          <p className="pipeline-step-description">
            Select a study, configure models, upload documents, and run extractions. Progress stays available in the
            activity panel while you navigate.
          </p>
        </div>
      </header>

      <section ref={studyRef} id="study-setup-study" className="study-setup-section">
        <StudyStepPage studyId={studyId} onStudyIdChange={onStudyIdChange} onCreated={onStudyCreated} />
      </section>

      <section ref={configRef} id="study-setup-config" className="study-setup-section">
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

      <section ref={processingRef} id="study-setup-processing" className="study-setup-section">
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
