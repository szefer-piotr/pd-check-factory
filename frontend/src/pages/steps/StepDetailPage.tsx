import type { PipelineStepDefinition } from "../../types/pipeline";

interface StepDetailPageProps {
  step: PipelineStepDefinition;
}

export function StepDetailPage({ step }: StepDetailPageProps): JSX.Element {
  return (
    <article className="step-page" aria-label={step.title}>
      <header className="step-page-header">
        <h2>{step.title}</h2>
        <p>{step.summary}</p>
      </header>
    </article>
  );
}
