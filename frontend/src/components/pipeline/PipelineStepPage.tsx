import type { ReactNode } from "react";
import { Card } from "../layout/Card";
import { Stack } from "../layout/Stack";
import { LlmProgressBar } from "../workflow/LlmProgressBar";
import { LogPanel } from "./LogPanel";
import type { LlmProgress, PipelineLogLine } from "../../services/stepApi";

export type StepRunState = "idle" | "running" | "done" | "failed";

interface PipelineStepPageProps {
  title: string;
  description: string;
  status: StepRunState;
  isComplete: boolean;
  canRun: boolean;
  isRunning: boolean;
  runLabel?: string;
  rerunLabel?: string;
  onRun: (force: boolean) => void;
  logs: PipelineLogLine[];
  llmProgress?: LlmProgress | null;
  error?: string;
  message?: string;
  children?: ReactNode;
}

export function PipelineStepPage({
  title,
  description,
  status,
  isComplete,
  canRun,
  isRunning,
  runLabel = "Run step",
  rerunLabel = "Re-run",
  onRun,
  logs,
  llmProgress,
  error,
  message,
  children
}: PipelineStepPageProps): JSX.Element {
  const statusLabel =
    status === "running" ? "Running" : status === "failed" ? "Failed" : isComplete ? "Complete" : "Pending";

  return (
    <div className="pipeline-step-page">
    <Stack gap="md">
      <header className="pipeline-step-header">
        <div>
          <h1>{title}</h1>
          <p className="pipeline-step-description">{description}</p>
        </div>
        <span className={`pipeline-step-badge pipeline-step-badge-${status}`}>{statusLabel}</span>
      </header>

      {isRunning ? (
        <div className="pipeline-run-banner" role="status">
          Processing in progress — do not close the browser.
        </div>
      ) : null}

      {error ? <p className="pipeline-error">{error}</p> : null}
      {message ? <p className="pipeline-message">{message}</p> : null}

      {children ? <Card>{children}</Card> : null}

      <div className="pipeline-step-actions">
        <button type="button" disabled={!canRun || isRunning} onClick={() => onRun(false)}>
          {isComplete ? rerunLabel : runLabel}
        </button>
        {isComplete ? (
          <button type="button" disabled={!canRun || isRunning} onClick={() => onRun(true)} className="secondary">
            Force re-run
          </button>
        ) : null}
      </div>

      {llmProgress ? <LlmProgressBar progress={llmProgress} /> : null}

      <LogPanel logs={logs} active={isRunning || status === "running"} />
    </Stack>
    </div>
  );
}
