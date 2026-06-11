import { WORKFLOW_LABELS, type WorkflowChoice } from "../../data/wizardSteps";
import type { StudySettings } from "../../hooks/useStudySettings";
import type { StudySummary, Step1PdfExtractor } from "../../services/stepApi";

const EXTRACTOR_LABELS: Record<Step1PdfExtractor, string> = {
  both: "Auto (recommended)",
  opendataloader: "OpenDataLoader",
  document_intelligence: "Document Intelligence (Azure)"
};

interface SummaryPageProps {
  studyId: string;
  workflow: WorkflowChoice | null;
  summary: StudySummary | null;
  settings: StudySettings;
  isLoading: boolean;
}

function formatBytes(size: number): string {
  if (!size) {
    return "—";
  }
  if (size < 1024) {
    return `${size} B`;
  }
  return `${(size / 1024).toFixed(1)} KB`;
}

export function SummaryPage({ studyId, workflow, summary, settings, isLoading }: SummaryPageProps): JSX.Element {
  return (
    <section className="wizard-summary" aria-label="Summary">
      <h2>Summary</h2>
      <p className="step7-muted">Review your configuration before starting extraction.</p>
      {isLoading && !summary ? <p className="step7-muted">Loading…</p> : null}
      <dl className="wizard-summary-list">
        <div>
          <dt>Study ID</dt>
          <dd>{studyId}</dd>
        </div>
        <div>
          <dt>Workflow</dt>
          <dd>{workflow ? WORKFLOW_LABELS[workflow] : "—"}</dd>
        </div>
        {workflow === "extract" ? (
          <div>
            <dt>OCR method</dt>
            <dd>{EXTRACTOR_LABELS[settings.extractorChoice]}</dd>
          </div>
        ) : null}
        {(workflow === "extract" || workflow === "enrich") && settings.extractionDeployment ? (
          <div>
            <dt>Extraction model</dt>
            <dd>{settings.extractionDeployment}</dd>
          </div>
        ) : null}
        {(workflow === "extract" || workflow === "enrich") && settings.acrfSummaryDeployment ? (
          <div>
            <dt>aCRF summary model</dt>
            <dd>{settings.acrfSummaryDeployment}</dd>
          </div>
        ) : null}
        <div>
          <dt>Protocol</dt>
          <dd>
            {summary?.uploads.protocol.uploaded
              ? `${summary.uploads.protocol.fileName} (${formatBytes(summary.uploads.protocol.size)})`
              : "Not uploaded"}
          </dd>
        </div>
        <div>
          <dt>aCRF</dt>
          <dd>
            {summary?.uploads.acrf.uploaded
              ? `${summary.uploads.acrf.fileName} (${formatBytes(summary.uploads.acrf.size)})`
              : "Not uploaded"}
          </dd>
        </div>
        {workflow === "map" || workflow === "enrich" ? (
          <div>
            <dt>PD Specifications</dt>
            <dd>
              {summary?.uploads.pdSpec.uploaded
                ? `${summary.uploads.pdSpec.fileName} (${formatBytes(summary.uploads.pdSpec.size)})`
                : "Not uploaded"}
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}
