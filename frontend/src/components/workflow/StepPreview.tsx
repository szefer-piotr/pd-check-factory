import type { PipelinePreviewItem } from "../../types/pipeline";

interface StepPreviewProps {
  previews: PipelinePreviewItem[];
}

export function StepPreview({ previews }: StepPreviewProps): JSX.Element {
  return (
    <section className="preview-block" aria-label="Step preview results">
      <h3>Preview Results</h3>
      <div className="preview-list">
        {previews.map((preview) => (
          <article key={preview.title} className={`preview-item ${preview.highlight ? "preview-item-highlight" : ""}`}>
            <p className="preview-title">{preview.title}</p>
            <pre className="preview-body">{preview.body}</pre>
          </article>
        ))}
      </div>
    </section>
  );
}
