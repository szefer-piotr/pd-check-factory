import type { PipelinePreviewItem } from "../../types/pipeline";
import {
  extractDeviationsFromJson,
  extractRulesFromJson,
  isFileListPreview,
  parseFileList,
  tryParseJson
} from "../../utils/previewFormat";
import { DeviationsPreview } from "./preview/DeviationsPreview";
import { RulesPreview } from "./preview/RulesPreview";

interface StepPreviewProps {
  stepId: string;
  previews: PipelinePreviewItem[];
  hasRun?: boolean;
}

function renderPreviewBody(stepId: string, preview: PipelinePreviewItem): JSX.Element {
  if (isFileListPreview(preview.title, preview.body)) {
    const files = parseFileList(preview.body);
    return (
      <ul className="preview-file-list">
        {files.map((file) => (
          <li key={file}>{file}</li>
        ))}
      </ul>
    );
  }

  const parsed = tryParseJson(preview.body);
  if (parsed !== null) {
    if (stepId === "extract-rules" || preview.title.toLowerCase().includes("rule")) {
      const rows = extractRulesFromJson(parsed);
      if (rows.length > 0) {
        return <RulesPreview rows={rows} />;
      }
    }
    if (stepId === "extract-deviations" || preview.title.toLowerCase().includes("deviation")) {
      const rows = extractDeviationsFromJson(parsed);
      if (rows.length > 0) {
        return <DeviationsPreview rows={rows} />;
      }
    }
  }

  return <pre className="preview-body">{preview.body}</pre>;
}

export function StepPreview({ stepId, previews, hasRun = false }: StepPreviewProps): JSX.Element {
  if (previews.length === 0) {
    return (
      <section className="preview-block" aria-label="Step preview">
        <h3>Preview</h3>
        <p className="preview-empty">
          {hasRun ? "No preview data available yet." : "Run this step to generate a preview."}
        </p>
      </section>
    );
  }

  return (
    <section className="preview-block" aria-label="Step preview results">
      <h3>Preview</h3>
      <div className="preview-list">
        {previews.map((preview) => (
          <article key={preview.title} className="preview-item">
            <p className="preview-title">{preview.title}</p>
            {renderPreviewBody(stepId, preview)}
          </article>
        ))}
      </div>
    </section>
  );
}
