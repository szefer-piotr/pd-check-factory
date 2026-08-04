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
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el) {
      return;
    }
    const onScroll = (): void => {
      const remaining = el.scrollHeight - el.scrollTop - el.clientHeight;
      stickToBottomRef.current = remaining < 48;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = bodyRef.current;
    if (!el || !active) {
      return;
    }
    if (stickToBottomRef.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [active, logs.length]);

  return (
    <div className={`log-panel ${className}`.trim()} aria-live="polite">
      <div className="log-panel-header">
        <span>Activity log</span>
        {active ? <span className="log-panel-live">Live</span> : null}
      </div>
      <div className="log-panel-body" ref={bodyRef}>
        {logs.length === 0 ? (
          <p className="log-panel-empty">No log entries yet. Run a step to see progress.</p>
        ) : (
          logs.map((line, index) => (
            <div key={`${line.ts}-${index}`} className={`log-panel-line log-panel-line-${line.level}`}>
              <span className="log-panel-ts">{formatTs(line.ts)}</span>
              <span className="log-panel-text">{line.text}</span>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
