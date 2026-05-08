import { Page } from "../components/layout/Page";
import { Section } from "../components/layout/Section";
import { Stack } from "../components/layout/Stack";
import { StudySelector } from "../components/ui/StudySelector";
import { useStudyDashboard } from "../hooks/useStudyDashboard";
import { useMemo, useState } from "react";

type PipelineStepStatus = "pending" | "running" | "done";

interface PipelineStep {
  id: string;
  title: string;
  instruction: string;
  status: PipelineStepStatus;
  result: string | null;
}

const PIPELINE_TEMPLATE: PipelineStep[] = [
  {
    id: "step-1",
    title: "Extract Inputs",
    instruction: "Load protocol and aCRF artifacts for the selected study.",
    status: "pending",
    result: null
  },
  {
    id: "step-2",
    title: "Index Protocol",
    instruction: "Build paragraph index and normalize references.",
    status: "pending",
    result: null
  },
  {
    id: "step-3",
    title: "Extract Rules",
    instruction: "Generate rule candidates from protocol text blocks.",
    status: "pending",
    result: null
  },
  {
    id: "step-4",
    title: "Extract Deviations",
    instruction: "Attach candidate deviations with context and evidence.",
    status: "pending",
    result: null
  },
  {
    id: "step-5",
    title: "Finalize Output",
    instruction: "Compile final review-ready deviation package.",
    status: "pending",
    result: null
  }
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function HomePage(): JSX.Element {
  const { studyId, setStudyId, data, isLoading, error, refresh } = useStudyDashboard("MY-STUDY");
  const [steps, setSteps] = useState<PipelineStep[]>(PIPELINE_TEMPLATE);
  const [activeStepId, setActiveStepId] = useState<string | null>(null);

  const nextPendingIndex = useMemo(() => steps.findIndex((step) => step.status === "pending"), [steps]);
  const allDone = steps.every((step) => step.status === "done");
  const anyRunning = steps.some((step) => step.status === "running");

  async function runStep(stepId: string): Promise<void> {
    if (anyRunning) {
      return;
    }

    setActiveStepId(stepId);
    setSteps((current) =>
      current.map((step) =>
        step.id === stepId
          ? {
              ...step,
              status: "running",
              result: null
            }
          : step
      )
    );

    await sleep(550);

    setSteps((current) =>
      current.map((step) =>
        step.id === stepId
          ? {
              ...step,
              status: "done",
              result: `${step.title} completed for ${studyId.trim() || "selected study"}.`
            }
          : step
      )
    );
    setActiveStepId(null);
  }

  async function runAll(): Promise<void> {
    for (const step of steps) {
      if (step.status !== "done") {
        // eslint-disable-next-line no-await-in-loop
        await runStep(step.id);
      }
    }
  }

  return (
    <Page>
      <Stack gap="lg">
        <Section>
          <header className="hero">
            <div>
              <h1>Pipeline Runner</h1>
              <p>Minimal workflow from first step to final output.</p>
            </div>
            <button className="button" type="button" onClick={() => void refresh()} disabled={isLoading}>
              {isLoading ? "Refreshing..." : "Sync study data"}
            </button>
          </header>
        </Section>

        <Section title="Study">
          <div className="controls-row">
            <StudySelector value={studyId} onChange={setStudyId} />
            <div className="control-group">
              <span className="control-label">Last update</span>
              <div className="inline-text">{new Date(data?.overview.updatedAt ?? Date.now()).toLocaleString()}</div>
            </div>
          </div>
        </Section>

        <Section title="Run Pipeline">
          <div className="pipeline-actions">
            <button
              className="button"
              type="button"
              disabled={anyRunning || nextPendingIndex < 0}
              onClick={() => void runStep(steps[nextPendingIndex].id)}
            >
              Run next step
            </button>
            <button className="button button-secondary" type="button" disabled={anyRunning || allDone} onClick={() => void runAll()}>
              Run all
            </button>
          </div>
          <div className="pipeline-list">
            {steps.map((step, index) => (
              <article key={step.id} className={`pipeline-step pipeline-step-${step.status}`} aria-live="polite">
                <div className="step-index">{index + 1}</div>
                <div className="step-body">
                  <div className="step-title-row">
                    <h3>{step.title}</h3>
                    <span className={`step-status step-status-${step.status}`}>{step.status}</span>
                  </div>
                  <p className="step-instruction">{step.instruction}</p>
                  <button
                    className="button button-link"
                    type="button"
                    disabled={anyRunning || step.status === "done"}
                    onClick={() => void runStep(step.id)}
                  >
                    {step.status === "running" ? "Running..." : step.status === "done" ? "Completed" : "Run this step"}
                  </button>
                  {step.result ? <p className="step-result">Result: {step.result}</p> : null}
                </div>
              </article>
            ))}
          </div>
        </Section>

        <Section title="Current Study Summary">
          {error ? <p className="error-inline">{error}</p> : null}
          <div className="summary-minimal">
            <div>Total deviations: {data?.overview.totalDeviations ?? "-"}</div>
            <div>Accepted: {data?.overview.acceptedCount ?? "-"}</div>
            <div>To review: {data?.overview.toReviewCount ?? "-"}</div>
            <div>Rejected: {data?.overview.rejectedCount ?? "-"}</div>
            <div>Active step: {activeStepId ?? "none"}</div>
          </div>
        </Section>
      </Stack>
    </Page>
  );
}
