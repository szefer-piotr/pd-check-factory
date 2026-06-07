import { useEffect, useState } from "react";
import type { ExtractionRunState } from "../../hooks/useStudyPipelineState";
import { ExtractionStatusPanel } from "./ExtractionStatusPanel";
import { LlmProgressBar } from "./LlmProgressBar";
import type { ProcessingSubProgressItem } from "./ProcessingPanel";

const DRAWER_VISIBLE_KEY = "pd-workflow-drawer-visible";

function readDrawerVisible(): boolean {
  try {
    const stored = sessionStorage.getItem(DRAWER_VISIBLE_KEY);
    if (stored === "false") {
      return false;
    }
  } catch {
    // ignore sessionStorage errors
  }
  return true;
}

function persistDrawerVisible(visible: boolean): void {
  try {
    sessionStorage.setItem(DRAWER_VISIBLE_KEY, visible ? "true" : "false");
  } catch {
    // ignore sessionStorage errors
  }
}

interface PipelineProgressDrawerProps {
  visible: boolean;
  extraction: ExtractionRunState;
  processingProgress: ProcessingSubProgressItem[];
  isProcessing: boolean;
  processingMessage: string;
  processingError: string;
  studyId: string;
  pollRunStateDuringExtract?: boolean;
  onRunStatePolled?: (runState: {
    logs: ExtractionRunState["logs"];
    message: string;
    currentSubStepId: string;
    currentStage: string;
    llmProgress?: ExtractionRunState["llmProgress"];
  }) => void;
}

export function PipelineProgressDrawer({
  visible,
  extraction,
  processingProgress,
  isProcessing,
  processingMessage,
  processingError,
  studyId,
  pollRunStateDuringExtract = false,
  onRunStatePolled
}: PipelineProgressDrawerProps): JSX.Element | null {
  const [open, setOpen] = useState(readDrawerVisible);

  useEffect(() => {
    persistDrawerVisible(open);
  }, [open]);

  if (!visible) {
    return null;
  }

  return (
    <aside
      className={`pipeline-progress-drawer ${open ? "pipeline-progress-drawer-open" : "pipeline-progress-drawer-collapsed"}`}
      aria-label="Pipeline progress"
    >
      <header className="pipeline-progress-drawer-header">
        {open ? (
          <>
            <span className="pipeline-progress-drawer-title">Pipeline progress</span>
            {isProcessing ? <span className="pipeline-progress-drawer-live">Live</span> : null}
          </>
        ) : null}
        <button
          className="button button-ghost pipeline-progress-drawer-toggle"
          type="button"
          aria-label={open ? "Hide pipeline progress" : "Show pipeline progress"}
          title={open ? "Hide pipeline progress" : "Show pipeline progress"}
          onClick={() => setOpen((previous) => !previous)}
        >
          {open ? "⟨" : "⟩"}
        </button>
      </header>
      {open ? (
        <div className="pipeline-progress-drawer-body">
          {extraction.llmProgress && extraction.llmProgress.total > 0 ? (
            <LlmProgressBar progress={extraction.llmProgress} />
          ) : null}
          <ExtractionStatusPanel
            extraction={extraction}
            processingProgress={processingProgress}
            isProcessing={isProcessing}
            processingMessage={processingMessage}
            processingError={processingError}
            studyId={studyId}
            pollRunStateDuringExtract={pollRunStateDuringExtract}
            onRunStatePolled={onRunStatePolled}
          />
        </div>
      ) : null}
    </aside>
  );
}
