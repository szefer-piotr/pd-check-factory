import { useState } from "react";
import type { PipelineLogLine } from "../../services/stepApi";
import { LogPanel } from "./LogPanel";

interface PipelineLogDrawerProps {
  logs: PipelineLogLine[];
  active: boolean;
}

export function PipelineLogDrawer({ logs, active }: PipelineLogDrawerProps): JSX.Element {
  const [expanded, setExpanded] = useState(true);

  return (
    <aside
      className={`pipeline-log-drawer ${expanded ? "" : "pipeline-log-drawer-collapsed"}`.trim()}
      aria-label="Pipeline activity log"
    >
      <div className="pipeline-log-drawer-header">
        {expanded ? (
          <>
            <span className="pipeline-log-drawer-title">Activity log</span>
            {active ? <span className="pipeline-log-drawer-live">Live</span> : null}
          </>
        ) : null}
        <button
          type="button"
          className="secondary pipeline-log-drawer-toggle"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-label={expanded ? "Collapse activity log" : "Expand activity log"}
        >
          {expanded ? "›" : "‹"}
        </button>
      </div>
      {expanded ? <LogPanel logs={logs} active={active} className="pipeline-log-drawer-panel" /> : null}
    </aside>
  );
}
