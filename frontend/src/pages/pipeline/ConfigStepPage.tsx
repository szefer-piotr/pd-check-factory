import { Card } from "../../components/layout/Card";
import { Stack } from "../../components/layout/Stack";
import { LlmDeploymentSelect } from "../../components/ui/LlmDeploymentSelect";
import type { OpenAiDeploymentOption } from "../../services/stepApi";
import type { StudySettings } from "../../hooks/useStudySettings";

interface ConfigStepPageProps {
  settings: StudySettings;
  onChange: (patch: Partial<StudySettings>) => void;
  onSave: () => void;
  saved: boolean;
  deployments: OpenAiDeploymentOption[];
  deploymentsLoading: boolean;
  defaultDeployment: string;
}

export function ConfigStepPage({
  settings,
  onChange,
  onSave,
  saved,
  deployments,
  deploymentsLoading,
  defaultDeployment
}: ConfigStepPageProps): JSX.Element {
  return (
    <Stack gap="md">
      <div className="pipeline-step-page">
      <header className="pipeline-step-header">
        <div>
          <h2>Model configuration</h2>
          <p className="pipeline-step-description">
            Choose Azure OpenAI deployments. PDF extraction uses Document Intelligence only.
          </p>
        </div>
        {saved ? <span className="pipeline-step-badge pipeline-step-badge-done">Saved</span> : null}
      </header>

      <Card>
        <Stack gap="md">
          <LlmDeploymentSelect
            id="extraction-deployment"
            label="Rules & deviations extraction"
            value={settings.extractionDeployment || defaultDeployment}
            deployments={deployments}
            isLoading={deploymentsLoading}
            onChange={(value) => onChange({ extractionDeployment: value })}
          />
          <LlmDeploymentSelect
            id="acrf-summary-deployment"
            label="aCRF summary"
            value={settings.acrfSummaryDeployment || defaultDeployment}
            deployments={deployments}
            isLoading={deploymentsLoading}
            onChange={(value) => onChange({ acrfSummaryDeployment: value })}
          />
          <LlmDeploymentSelect
            id="chat-deployment"
            label="Deviation chat / refinement"
            value={settings.chatDeployment || defaultDeployment}
            deployments={deployments}
            isLoading={deploymentsLoading}
            onChange={(value) => onChange({ chatDeployment: value })}
          />
          <label className="pipeline-field">
            <span>Extra LLM instructions (optional)</span>
            <textarea
              rows={4}
              value={settings.extractionLlmInstructions}
              onChange={(event) => onChange({ extractionLlmInstructions: event.target.value })}
              placeholder="e.g. Focus on visit-window deviations"
            />
          </label>
          <button type="button" className="button button-primary" onClick={onSave}>
            Save configuration
          </button>
        </Stack>
      </Card>
      </div>
    </Stack>
  );
}
