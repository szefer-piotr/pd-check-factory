import type { OpenAiDeploymentOption, StudyOption } from "../../services/stepApi";
import { BlobProjectPicker } from "./BlobProjectPicker";
import { LlmDeploymentSelect } from "./LlmDeploymentSelect";

interface StudySelectorProps {
  value: string;
  onChange: (next: string) => void;
  onNewStudy?: () => void;
  onDeleteStudy?: () => void;
  studies: StudyOption[];
  isLoading?: boolean;
  isDeleting?: boolean;
  error?: string;
  onReload?: () => void;
  blobPickerId?: string;
  llmDeployments?: OpenAiDeploymentOption[];
  deploymentsLoading?: boolean;
  extractionDeployment?: string;
  onExtractionDeploymentChange?: (value: string) => void;
  acrfSummaryDeployment?: string;
  onAcrfSummaryDeploymentChange?: (value: string) => void;
}

export function StudySelector({
  value,
  onChange,
  onNewStudy,
  onDeleteStudy,
  studies,
  isLoading = false,
  isDeleting = false,
  error = "",
  onReload,
  blobPickerId,
  llmDeployments,
  deploymentsLoading = false,
  extractionDeployment = "",
  onExtractionDeploymentChange,
  acrfSummaryDeployment = "",
  onAcrfSummaryDeploymentChange
}: StudySelectorProps): JSX.Element {
  const normalizedValue = value.trim();
  const showModelSelectors =
    llmDeployments !== undefined &&
    onExtractionDeploymentChange !== undefined &&
    onAcrfSummaryDeploymentChange !== undefined;

  return (
    <div className="study-selector">
      <div className="study-selector-row">
        <BlobProjectPicker
          id={blobPickerId}
          value={value}
          studies={studies}
          isLoading={isLoading}
          error={error}
          onChange={onChange}
          onReload={onReload}
        />
        {onNewStudy ? (
          <button className="button button-primary study-selector-action" type="button" onClick={onNewStudy} disabled={isLoading || isDeleting}>
            New study
          </button>
        ) : null}
        {onDeleteStudy ? (
          <button
            className="button button-danger study-selector-action"
            type="button"
            onClick={onDeleteStudy}
            disabled={isLoading || isDeleting || !normalizedValue}
            title={normalizedValue ? `Delete all blob data for ${normalizedValue}` : "Select a study to delete"}
          >
            {isDeleting ? "Deleting…" : "Delete study"}
          </button>
        ) : null}
      </div>
      {showModelSelectors ? (
        <div className="study-selector-models-row">
          <LlmDeploymentSelect
            id="study-extraction-llm-deployment"
            label="Extraction model"
            value={extractionDeployment}
            deployments={llmDeployments}
            onChange={onExtractionDeploymentChange}
            isLoading={deploymentsLoading}
          />
          <LlmDeploymentSelect
            id="study-acrf-summary-llm-deployment"
            label="aCRF summary model"
            value={acrfSummaryDeployment}
            deployments={llmDeployments}
            onChange={onAcrfSummaryDeploymentChange}
            isLoading={deploymentsLoading}
          />
        </div>
      ) : null}
    </div>
  );
}
