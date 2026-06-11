import { StudyPipelineView } from "../../components/workflow/StudyPipelineView";
import { LlmDeploymentSelect } from "../../components/ui/LlmDeploymentSelect";
import type { WorkflowChoice } from "../../data/wizardSteps";
import type { UseStudyPipelineStateResult } from "../../hooks/useStudyPipelineState";
import type { StudySettings } from "../../hooks/useStudySettings";
import type { OpenAiDeploymentOption, Step1PdfExtractor, StepStatus } from "../../services/stepApi";

const EXTRACTOR_OPTIONS: Array<{ value: Step1PdfExtractor; label: string }> = [
  { value: "both", label: "Auto (recommended)" },
  { value: "opendataloader", label: "OpenDataLoader" },
  { value: "document_intelligence", label: "Document Intelligence (Azure)" }
];

interface SetupPageProps {
  studyId: string;
  workflow: WorkflowChoice | null;
  pipelineState: UseStudyPipelineStateResult;
  backendStatuses: Record<string, StepStatus>;
  onStatusesChange: (statuses: Record<string, StepStatus>) => void;
  onStudiesReload?: () => void;
  settings: StudySettings;
  onSettingsChange: (patch: Partial<StudySettings>) => void;
  llmDeployments: OpenAiDeploymentOption[];
  deploymentsLoading: boolean;
}

export function SetupPage({
  studyId,
  workflow,
  pipelineState,
  backendStatuses,
  onStatusesChange,
  onStudiesReload,
  settings,
  onSettingsChange,
  llmDeployments,
  deploymentsLoading
}: SetupPageProps): JSX.Element {
  const showLlmSettings = workflow === "extract" || workflow === "enrich";
  const showPdSpec = workflow === "map" || workflow === "enrich";

  return (
    <section className="wizard-setup" aria-label="Setup">
      <h2>Setup</h2>
      <p className="step7-muted">Configure options and upload source documents for this workflow.</p>

      {showLlmSettings ? (
        <div className="wizard-setup-settings">
          <h3>LLM deployments</h3>
          <div className="settings-drawer-fields">
            <LlmDeploymentSelect
              id="setup-extraction-llm"
              label="Extraction model"
              value={settings.extractionDeployment}
              deployments={llmDeployments}
              onChange={(value) => onSettingsChange({ extractionDeployment: value })}
              isLoading={deploymentsLoading}
            />
            <LlmDeploymentSelect
              id="setup-acrf-summary-llm"
              label="aCRF summary model"
              value={settings.acrfSummaryDeployment}
              deployments={llmDeployments}
              onChange={(value) => onSettingsChange({ acrfSummaryDeployment: value })}
              isLoading={deploymentsLoading}
            />
          </div>
          {workflow === "extract" ? (
            <label className="wizard-field">
              <span>OCR method</span>
              <select
                value={settings.extractorChoice}
                onChange={(event) =>
                  onSettingsChange({ extractorChoice: event.target.value as Step1PdfExtractor })
                }
              >
                {EXTRACTOR_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
        </div>
      ) : null}

      <StudyPipelineView
        studyId={studyId}
        pipelineState={pipelineState}
        backendStatuses={backendStatuses}
        onStatusesChange={onStatusesChange}
        onRunFullPipeline={async () => {}}
        onReRunPipeline={async () => {}}
        onMapPdSpecToReview={async () => {}}
        onEnrichPdSpecToReview={async () => {}}
        onStudiesReload={onStudiesReload}
        isProcessing={false}
        isPdSpecActionRunning={false}
        processingMessage=""
        processingError=""
        pdSpecActionMessage=""
        pdSpecActionError=""
        extractorChoice={settings.extractorChoice}
        uploadsOnly
        showPdSpecSlot={showPdSpec}
      />
    </section>
  );
}
