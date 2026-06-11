import type { OpenAiDeploymentOption, Step1PdfExtractor } from "../../services/stepApi";
import { LlmDeploymentSelect } from "./LlmDeploymentSelect";

const EXTRACTOR_LABELS: Record<Step1PdfExtractor, string> = {
  both: "Auto (recommended)",
  opendataloader: "OpenDataLoader",
  document_intelligence: "Document Intelligence (Azure)"
};

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
  studyId: string;
  llmDeployments: OpenAiDeploymentOption[];
  deploymentsLoading: boolean;
  extractorChoice: Step1PdfExtractor;
  onExtractorChange: (value: Step1PdfExtractor) => void;
  extractionLlmInstructions: string;
  onExtractionLlmInstructionsChange: (value: string) => void;
  extractionDeployment: string;
  onExtractionDeploymentChange: (value: string) => void;
  acrfSummaryDeployment: string;
  onAcrfSummaryDeploymentChange: (value: string) => void;
  chatDeployment: string;
  onChatDeploymentChange: (value: string) => void;
}

export function SettingsDrawer({
  open,
  onClose,
  studyId,
  llmDeployments,
  deploymentsLoading,
  extractorChoice,
  onExtractorChange,
  extractionLlmInstructions,
  onExtractionLlmInstructionsChange,
  extractionDeployment,
  onExtractionDeploymentChange,
  acrfSummaryDeployment,
  onAcrfSummaryDeploymentChange,
  chatDeployment,
  onChatDeploymentChange
}: SettingsDrawerProps): JSX.Element | null {
  if (!open) {
    return null;
  }

  const settingsDisabled = !studyId.trim();

  return (
    <>
      <button
        className="settings-drawer-backdrop"
        type="button"
        aria-label="Close settings"
        onClick={onClose}
      />
      <aside className="settings-drawer" aria-label="Pipeline settings">
        <header className="settings-drawer-header">
          <h2 className="settings-drawer-title">Pipeline settings</h2>
          <button className="button button-ghost settings-drawer-close" type="button" onClick={onClose}>
            Close
          </button>
        </header>

        {settingsDisabled ? (
          <p className="step7-muted">Select a study to configure pipeline settings.</p>
        ) : (
          <div className="settings-drawer-body">
            <section className="settings-drawer-section">
              <h3 className="settings-drawer-section-title">LLM deployments</h3>
              <div className="settings-drawer-fields">
                <LlmDeploymentSelect
                  id="settings-extraction-llm-deployment"
                  label="Extraction model"
                  value={extractionDeployment}
                  deployments={llmDeployments}
                  onChange={onExtractionDeploymentChange}
                  isLoading={deploymentsLoading}
                />
                <LlmDeploymentSelect
                  id="settings-acrf-summary-llm-deployment"
                  label="aCRF summary model"
                  value={acrfSummaryDeployment}
                  deployments={llmDeployments}
                  onChange={onAcrfSummaryDeploymentChange}
                  isLoading={deploymentsLoading}
                />
                <LlmDeploymentSelect
                  id="settings-chat-llm-deployment"
                  label="Chat / refinement model"
                  value={chatDeployment}
                  deployments={llmDeployments}
                  onChange={onChatDeploymentChange}
                  isLoading={deploymentsLoading}
                />
              </div>
            </section>

            <section className="settings-drawer-section">
              <h3 className="settings-drawer-section-title">PDF extraction</h3>
              <fieldset className="step1-extractor-fieldset">
                <legend className="control-label">PDF extractor</legend>
                <div className="step1-extractor-options">
                  {(["both", "document_intelligence", "opendataloader"] as const).map((value) => (
                    <label className="step1-radio-label" key={value}>
                      <input
                        type="radio"
                        name="settings-pdf-extractor"
                        value={value}
                        checked={extractorChoice === value}
                        onChange={() => onExtractorChange(value)}
                      />
                      <span>{EXTRACTOR_LABELS[value]}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </section>

            <section className="settings-drawer-section">
              <h3 className="settings-drawer-section-title">Extraction guidance</h3>
              <label className="control-group" htmlFor="settings-extraction-llm-instructions">
                <span className="control-label">Optional LLM instructions</span>
                <textarea
                  id="settings-extraction-llm-instructions"
                  className="input"
                  rows={4}
                  value={extractionLlmInstructions}
                  onChange={(event) => onExtractionLlmInstructionsChange(event.target.value)}
                  placeholder="Additional guidance for rule and deviation extraction"
                />
              </label>
            </section>
          </div>
        )}
      </aside>
    </>
  );
}
