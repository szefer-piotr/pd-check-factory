import { useEffect, useState } from "react";
import { Panel } from "../components/layout/Panel";
import { LlmDeploymentSelect } from "../components/ui/LlmDeploymentSelect";
import {
  DEFAULT_SETTINGS,
  readGlobalLlmSettings,
  writeGlobalLlmSettings,
  type StudySettings
} from "../hooks/useStudySettings";
import {
  fetchOpenAiDeployments,
  type OpenAiDeploymentOption,
  type Step1PdfExtractor
} from "../services/stepApi";

const EXTRACTOR_LABELS: Record<Step1PdfExtractor, string> = {
  both: "Auto (recommended)",
  opendataloader: "OpenDataLoader",
  document_intelligence: "Document Intelligence (Azure)"
};

export function SettingsPage(): JSX.Element {
  const [settings, setSettings] = useState<StudySettings>(() => readGlobalLlmSettings());
  const [deployments, setDeployments] = useState<OpenAiDeploymentOption[]>([]);
  const [defaultDeployment, setDefaultDeployment] = useState("");
  const [deploymentsLoading, setDeploymentsLoading] = useState(true);
  const [savedMessage, setSavedMessage] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      setDeploymentsLoading(true);
      try {
        const result = await fetchOpenAiDeployments();
        if (!cancelled) {
          setDeployments(result.deployments);
          setDefaultDeployment(result.defaultDeployment);
        }
      } finally {
        if (!cancelled) {
          setDeploymentsLoading(false);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  function patch(next: Partial<StudySettings>): void {
    setSettings((previous) => ({ ...previous, ...next }));
    setSavedMessage("");
  }

  function handleSave(): void {
    const normalized = {
      ...settings,
      extractionDeployment: settings.extractionDeployment || defaultDeployment,
      acrfSummaryDeployment: settings.acrfSummaryDeployment || defaultDeployment,
      chatDeployment: settings.chatDeployment || defaultDeployment
    };
    writeGlobalLlmSettings(normalized);
    setSettings(normalized);
    setSavedMessage("Defaults saved. New studies inherit these LLM settings.");
  }

  function handleReset(): void {
    setSettings(DEFAULT_SETTINGS);
    writeGlobalLlmSettings(DEFAULT_SETTINGS);
    setSavedMessage("Defaults cleared.");
  }

  return (
    <div className="settings-page">
      <header className="page-hero">
        <h1>Settings</h1>
        <p>
          Default Azure OpenAI deployments and PDF extractor preference. Study-scoped configuration still lives in
          Pipeline → Model configuration.
        </p>
      </header>

      <div className="settings-page-stack">
        <Panel title="LLM deployments" subtitle="Used as defaults when a study has no saved models">
          <div className="settings-fields">
            <LlmDeploymentSelect
              id="global-extraction-deployment"
              label="Rules & deviations extraction"
              value={settings.extractionDeployment || defaultDeployment}
              deployments={deployments}
              isLoading={deploymentsLoading}
              onChange={(value) => patch({ extractionDeployment: value })}
            />
            <LlmDeploymentSelect
              id="global-acrf-summary-deployment"
              label="aCRF summary"
              value={settings.acrfSummaryDeployment || defaultDeployment}
              deployments={deployments}
              isLoading={deploymentsLoading}
              onChange={(value) => patch({ acrfSummaryDeployment: value })}
            />
            <LlmDeploymentSelect
              id="global-chat-deployment"
              label="Chat / refinement"
              value={settings.chatDeployment || defaultDeployment}
              deployments={deployments}
              isLoading={deploymentsLoading}
              onChange={(value) => patch({ chatDeployment: value })}
            />
            <label className="pipeline-field" htmlFor="global-extraction-instructions">
              <span>Extra LLM instructions (optional)</span>
              <textarea
                id="global-extraction-instructions"
                rows={4}
                value={settings.extractionLlmInstructions}
                onChange={(event) => patch({ extractionLlmInstructions: event.target.value })}
                placeholder="e.g. Focus on visit-window deviations"
              />
            </label>
          </div>
        </Panel>

        <Panel title="PDF extraction" subtitle="Preferred extractor for new study drafts">
          <fieldset className="step1-extractor-fieldset">
            <legend className="control-label">PDF extractor</legend>
            <div className="step1-extractor-options">
              {(["both", "document_intelligence", "opendataloader"] as const).map((value) => (
                <label className="step1-radio-label" key={value}>
                  <input
                    type="radio"
                    name="global-pdf-extractor"
                    value={value}
                    checked={settings.extractorChoice === value}
                    onChange={() => patch({ extractorChoice: value })}
                  />
                  <span>{EXTRACTOR_LABELS[value]}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </Panel>

        <div className="settings-page-actions">
          <button type="button" className="button button-primary" onClick={handleSave}>
            Save defaults
          </button>
          <button type="button" className="button button-secondary" onClick={handleReset}>
            Clear defaults
          </button>
        </div>
        {savedMessage ? <p className="pipeline-message">{savedMessage}</p> : null}
      </div>
    </div>
  );
}
