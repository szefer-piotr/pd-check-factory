import { LlmProgressBar } from "../workflow/LlmProgressBar";
import type { LlmProgress, PipelineLogLine } from "../../services/stepApi";
import { LogPanel } from "./LogPanel";

interface ActivityPanelProps {
  open: boolean;
  onClose: () => void;
  isRunActive: boolean;
  activeJobLabel: string;
  queueLength: number;
  logs: PipelineLogLine[];
  llmProgress: LlmProgress | null;
  runStateStatus: string;
}

export function ActivityPanel({
  open,
  onClose,
  isRunActive,
  activeJobLabel,
  queueLength,
  logs,
  llmProgress,
  runStateStatus
}: ActivityPanelProps): JSX.Element | null {
  if (!open) {
    return null;
  }

  return (
    <aside className="activity-panel" aria-label="Pipeline activity">
      <header className="activity-panel-header">
        <div>
          <h2 className="activity-panel-title">Activity</h2>
          <p className="activity-panel-sub">
            {isRunActive
              ? `${activeJobLabel || "Processing"}…${queueLength > 0 ? ` (${queueLength} queued)` : ""}`
              : runStateStatus === "failed"
                ? "Last run failed"
                : "Idle — runs continue while you navigate"}
          </p>
        </div>
        <button type="button" className="button button-ghost activity-panel-close" onClick={onClose} aria-label="Close activity">
          ✕
        </button>
      </header>

      {isRunActive ? (
        <div className="activity-panel-live" role="status">
          <span className="spinner spinner-sm" aria-hidden />
          Keep this tab open while a job is in flight.
        </div>
      ) : null}

      {llmProgress ? (
        <div className="activity-panel-progress">
          <LlmProgressBar progress={llmProgress} />
        </div>
      ) : null}

      <div className="activity-panel-logs">
        <LogPanel logs={logs} active={isRunActive} />
      </div>
    </aside>
  );
}
