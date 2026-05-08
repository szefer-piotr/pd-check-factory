import { StepArtifacts } from "../../components/workflow/StepArtifacts";
import { StepPreview } from "../../components/workflow/StepPreview";
import { Stack } from "../../components/layout/Stack";
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

      <Stack gap="md">
        <section className="instruction-block" aria-label="Step instructions">
          <h3>Instructions</h3>
          <ol className="instruction-list">
            {step.instructions.map((instruction) => (
              <li key={instruction}>{instruction}</li>
            ))}
          </ol>
        </section>

        <StepArtifacts title="Input Sources" artifacts={step.inputSources} />
        <StepArtifacts title="Outputs Passed to Next Step" artifacts={step.outputArtifacts} />
        <StepPreview previews={step.previewItems} />
      </Stack>
    </article>
  );
}
