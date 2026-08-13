import { useEffect, useMemo, useState } from "react";
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
  embedded?: boolean;
}

export function ConfigStepPage({
  settings,
  onChange,
  onSave,
  saved,
  deployments,
  deploymentsLoading,
  defaultDeployment,
  embedded = false
}: ConfigStepPageProps): JSX.Element {
  const extraction = settings.extractionDeployment || defaultDeployment;
  const acrfSummary = settings.acrfSummaryDeployment || defaultDeployment;
  const chat = settings.chatDeployment || defaultDeployment;

  const allSame = Boolean(extraction) && extraction === acrfSummary && extraction === chat;
  const [useSameModel, setUseSameModel] = useState(allSame || !settings.acrfSummaryDeployment);

  useEffect(() => {
    if (allSame) {
      setUseSameModel(true);
    }
  }, [allSame]);

  const sharedValue = useMemo(() => extraction || defaultDeployment, [defaultDeployment, extraction]);

  function applyShared(value: string): void {
    onChange({
      extractionDeployment: value,
      acrfSummaryDeployment: value,
      chatDeployment: value
    });
  }

  return (
    <div className={`pipeline-step-page ${embedded ? "pipeline-step-page-embedded" : ""}`}>
      {!embedded ? (
        <header className="pipeline-step-header">
          <div>
            <h2>Model configuration</h2>
            <p className="pipeline-step-description">
              Choose Azure OpenAI deployments. Saved values are stored with the study in blob and restored when you
              select it. PDF extraction uses Document Intelligence only.
            </p>
          </div>
          {saved ? (
            <span className="pipeline-step-badge pipeline-step-badge-done">Saved</span>
          ) : (
            <span className="pipeline-step-badge">Required</span>
          )}
        </header>
      ) : (
        <div className="study-setup-section-head">
          <div>
            <h2>Model configuration</h2>
            <p className="pipeline-step-description">
              Choose Azure OpenAI deployments. PDF extraction uses Document Intelligence only.
            </p>
          </div>
          {saved ? (
            <span className="pipeline-step-badge pipeline-step-badge-done">Saved</span>
          ) : (
            <span className="pipeline-step-badge">Required</span>
          )}
        </div>
      )}

      <div className="config-stage-panel">
        <label className="config-same-model">
          <input
            type="checkbox"
            checked={useSameModel}
            onChange={(event) => {
              const next = event.target.checked;
              setUseSameModel(next);
              if (next) {
                applyShared(sharedValue);
              }
            }}
          />
          <span>Use same model for all</span>
        </label>

        {useSameModel ? (
          <LlmDeploymentSelect
            id="shared-deployment"
            label="Model for rules, aCRF summary, and chat"
            value={sharedValue}
            deployments={deployments}
            isLoading={deploymentsLoading}
            onChange={applyShared}
          />
        ) : (
          <div className="config-model-grid">
            <LlmDeploymentSelect
              id="extraction-deployment"
              label="Rules & deviations extraction"
              value={extraction}
              deployments={deployments}
              isLoading={deploymentsLoading}
              onChange={(value) => onChange({ extractionDeployment: value })}
            />
            <LlmDeploymentSelect
              id="acrf-summary-deployment"
              label="aCRF summary"
              value={acrfSummary}
              deployments={deployments}
              isLoading={deploymentsLoading}
              onChange={(value) => onChange({ acrfSummaryDeployment: value })}
            />
            <LlmDeploymentSelect
              id="chat-deployment"
              label="Deviation chat / refinement"
              value={chat}
              deployments={deployments}
              isLoading={deploymentsLoading}
              onChange={(value) => onChange({ chatDeployment: value })}
            />
          </div>
        )}

        <details className="config-advanced">
          <summary>Advanced</summary>
          <label className="pipeline-field">
            <span>Extra LLM instructions (optional)</span>
            <textarea
              rows={4}
              value={settings.extractionLlmInstructions}
              onChange={(event) => onChange({ extractionLlmInstructions: event.target.value })}
              placeholder="e.g. Focus on visit-window deviations"
            />
          </label>
        </details>

        <div className="pipeline-actions pipeline-actions-end">
          <button type="button" className="button button-primary" onClick={onSave}>
            Save configuration
          </button>
        </div>
      </div>
    </div>
  );
}
