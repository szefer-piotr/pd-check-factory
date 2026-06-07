import type { ExtractionRunState } from "../../hooks/useStudyPipelineState";
import { ExtractionStatusPanel } from "./ExtractionStatusPanel";
import type { ProcessingSubProgressItem } from "./ProcessingPanel";

interface ProgressDockProps {
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
  }) => void;
}

export function ProgressDock({
  visible,
  extraction,
  processingProgress,
  isProcessing,
  processingMessage,
  processingError,
  studyId,
  pollRunStateDuringExtract = false,
  onRunStatePolled
}: ProgressDockProps): JSX.Element | null {
  if (!visible) {
    return null;
  }

  return (
    <div className="progress-dock" aria-label="Pipeline progress">
      <div className="progress-dock-header">
        <span className="progress-dock-title">Pipeline progress</span>
        {isProcessing ? <span className="progress-dock-live">Live</span> : null}
      </div>
      <ExtractionStatusPanel
        extraction={extraction}
        processingProgress={processingProgress}
        isProcessing={isProcessing}
        processingMessage={processingMessage}
        processingError={processingError}
        studyId={studyId}
        pollRunStateDuringExtract={pollRunStateDuringExtract}
        simplified
        onRunStatePolled={onRunStatePolled}
      />
    </div>
  );
}
