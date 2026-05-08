import type { PipelineArtifact } from "../../types/pipeline";

interface StepArtifactsProps {
  title: string;
  artifacts: PipelineArtifact[];
}

export function StepArtifacts({ title, artifacts }: StepArtifactsProps): JSX.Element {
  return (
    <section className="artifact-block" aria-label={title}>
      <h3>{title}</h3>
      <div className="artifact-list">
        {artifacts.map((artifact) => (
          <article key={`${title}-${artifact.path}`} className="artifact-item">
            <p className="artifact-label">{artifact.label}</p>
            <p className="artifact-path">{artifact.path}</p>
            <p className="artifact-description">{artifact.description}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
