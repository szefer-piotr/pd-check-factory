import { useEffect, useRef } from "react";
import type { PipelineLogLine } from "../../services/stepApi";

interface LogPanelProps {
  logs: PipelineLogLine[];
  active: boolean;
  className?: string;
}

function formatTs(ts: string): string {
  if (!ts) {
    return "";
  }
  try {
    return new Date(ts).toLocaleTimeString();
  } catch {
    return ts;
  }
}

export function LogPanel({ logs, active, className = "" }: LogPanelProps): JSX.Element {
  const bottomRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (active && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [active, logs.length]);

  return (
    <div className={`log-panel ${className}`.trim()} aria-live="polite">
      <div className="log-panel-header">
        <span>Activity log</span>
        {active ? <span className="log-panel-live">Live</span> : null}
      </div>
      <div className="log-panel-body">
        {logs.length === 0 ? (
          <p className="log-panel-empty">No log entries yet. Run the step to see progress.</p>
        ) : (
          logs.map((line, index) => (
            <div key={`${line.ts}-${index}`} className={`log-panel-line log-panel-line-${line.level}`}>
              <span className="log-panel-ts">{formatTs(line.ts)}</span>
              <span className="log-panel-text">{line.text}</span>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}
