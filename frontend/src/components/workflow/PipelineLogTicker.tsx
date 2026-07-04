import { useEffect, useState } from "react";
import type { PipelineLogLine } from "../../services/stepApi";

interface PipelineLogTickerProps {
  logs: PipelineLogLine[];
  active: boolean;
  className?: string;
}

export function PipelineLogTicker({ logs, active, className = "" }: PipelineLogTickerProps): JSX.Element | null {
  const lastLine = logs.length > 0 ? logs[logs.length - 1]?.text ?? "" : "";
  const [visible, setVisible] = useState(false);
  const [displayText, setDisplayText] = useState("");

  useEffect(() => {
    if (!active || !lastLine) {
      setVisible(false);
      return;
    }
    setVisible(false);
    const showTimer = window.setTimeout(() => {
      setDisplayText(lastLine);
      setVisible(true);
    }, 50);
    return () => window.clearTimeout(showTimer);
  }, [active, lastLine]);

  if (!active || !displayText) {
    return null;
  }

  return (
    <div
      className={`pipeline-log-ticker ${visible ? "pipeline-log-ticker-visible" : ""} ${className}`.trim()}
      role="status"
      aria-live="polite"
      aria-atomic="true"
    >
      <span className="pipeline-log-ticker-text">{displayText}</span>
    </div>
  );
}
