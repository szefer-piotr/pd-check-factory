import { useState } from "react";
import { Panel } from "../components/layout/Panel";
import { navigateToPipelineStep } from "../pipeline/pipelineRoute";

const capabilities = [
  {
    title: "Study-scoped workspace",
    description: "Create or load a study, sync artifacts with blob storage, and keep settings with the study."
  },
  {
    title: "Document preprocessing",
    description: "Upload protocol and aCRF PDFs, run Document Intelligence extraction, and build paragraph indexes."
  },
  {
    title: "Rule extraction + chat",
    description: "Generate atomic protocol rules with paragraph references, then refine the list in chat."
  },
  {
    title: "Deviation candidates + chat",
    description: "Extract, classify, and consolidate protocol deviation checks; refine each row in chat."
  },
  {
    title: "Review and export",
    description: "Accept or reject deviations, refine fields in chat, and export review workbooks."
  },
  {
    title: "Cost visibility",
    description: "Inspect estimated Azure OpenAI and Document Intelligence spend for the active study."
  }
];

const workflowSteps = [
  {
    label: "Study setup",
    description: "Select or create a study, configure Azure OpenAI deployments, upload PDFs, and preprocess."
  },
  {
    label: "Rules",
    description: "Run rule extraction, preview results, and discuss edits in the rules chat."
  },
  {
    label: "Deviations",
    description: "Run deviation extraction, review candidates, and refine selected rows in chat."
  },
  {
    label: "Cost analysis",
    description: "Review estimated spend for Document Intelligence and OpenAI usage on this study."
  }
];

export function GuidePage(): JSX.Element {
  const [setupOpen, setSetupOpen] = useState(false);

  return (
    <div className="guide-page">
      <header className="page-hero">
        <h1>Operator guide</h1>
        <p>How PD Check turns protocol and aCRF documents into reviewable protocol deviations.</p>
        <button
          type="button"
          className="button button-primary"
          onClick={() => navigateToPipelineStep("study-setup")}
        >
          Open pipeline
        </button>
      </header>

      <div className="guide-capability-grid">
        {capabilities.map((item) => (
          <article key={item.title} className="guide-capability-card">
            <h3>{item.title}</h3>
            <p>{item.description}</p>
          </article>
        ))}
      </div>

      <Panel title="Workflow" subtitle="Typical path through the pipeline">
        <ol className="guide-stepper">
          {workflowSteps.map((step, index) => (
            <li key={step.label}>
              <span className="guide-step-index">{index + 1}</span>
              <div>
                <strong>{step.label}</strong>
                <p>{step.description}</p>
              </div>
            </li>
          ))}
        </ol>
      </Panel>

      <Panel
        title="Local developer setup"
        subtitle="Running the UI and Step API together"
        actions={
          <button type="button" className="button button-secondary" onClick={() => setSetupOpen((v) => !v)}>
            {setupOpen ? "Hide" : "Show"}
          </button>
        }
      >
        {setupOpen ? (
          <div className="guide-setup">
            <ol>
              <li>
                Copy <code>.env.example</code> to <code>.env</code> and fill Azure Storage, Document Intelligence, and
                OpenAI values.
              </li>
              <li>
                Install the Python package: <code>pip install -e .</code>
              </li>
              <li>
                From the repo root run <code>make dev</code> (Step API on <code>:8787</code>, Vite on{" "}
                <code>:5173</code>).
              </li>
              <li>Open the UI, create a study, and walk Study setup → Rules → Deviations → Cost.</li>
            </ol>
          </div>
        ) : (
          <p className="muted">
            Expand for install and <code>make dev</code> steps.
          </p>
        )}
      </Panel>
    </div>
  );
}
