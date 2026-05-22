import type { StepStatus } from "../../services/stepApi";
import { PdSpecImportSection } from "./PdSpecImportSection";

interface ImportGroundingPanelProps {
  studyId: string;
  backendStatuses: Record<string, StepStatus>;
  onStatusesChange: (statuses: Record<string, StepStatus>) => void;
  disabled?: boolean;
}

/** @deprecated Use PdSpecImportSection embedded in Step 1. Kept for compatibility. */
export function ImportGroundingPanel({
  studyId,
  backendStatuses,
  onStatusesChange,
  disabled = false
}: ImportGroundingPanelProps): JSX.Element {
  return (
    <PdSpecImportSection
      studyId={studyId}
      backendStatuses={backendStatuses}
      onStatusesChange={onStatusesChange}
      disabled={disabled}
    />
  );
}
