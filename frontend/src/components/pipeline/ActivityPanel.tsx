import { ArtifactVersionPicker } from "./ArtifactVersionPicker";
import { ParagraphViewer } from "../viewers/ParagraphViewer";
import { AcrfSummaryViewer } from "../workflow/AcrfSummaryViewer";
import { LlmProgressBar } from "../workflow/LlmProgressBar";
import type { InspectorTab } from "../../pipeline/pipelineNav";
import type { ArtifactVersionsSnapshot, ProtocolFocus } from "../../pipeline/pipelineNav";
import type { LlmProgress, PipelineLogLine } from "../../services/stepApi";
import { LogPanel } from "./LogPanel";

const INSPECTOR_TABS: { id: InspectorTab; label: string }[] = [
  { id: "protocol", label: "Protocol" },
  { id: "acrf", label: "aCRF" },
  { id: "versions", label: "Versions" },
  { id: "activity", label: "Activity" }
];

interface ActivityPanelProps {
  open: boolean;
  onClose: () => void;
  tab: InspectorTab;
  onTabChange: (tab: InspectorTab) => void;
  studyId: string;
  protocolFocus: ProtocolFocus;
  acrfFocusHint: string;
  artifactVersions: ArtifactVersionsSnapshot | null;
  isRunActive: boolean;
  activeJobLabel: string;
  queueLength: number;
  logs: PipelineLogLine[];
  llmProgress: LlmProgress | null;
  runStateStatus: string;
  /** Column = third pane in Rules/Deviations; overlay = fixed slide-over elsewhere. */
  variant?: "column" | "overlay";
}

export function ActivityPanel({
  open,
  onClose,
  tab,
  onTabChange,
  studyId,
  protocolFocus,
  acrfFocusHint,
  artifactVersions,
  isRunActive,
  activeJobLabel,
  queueLength,
  logs,
  llmProgress,
  runStateStatus,
  variant = "overlay"
}: ActivityPanelProps): JSX.Element | null {
  if (!open) {
    return null;
  }

  return (
    <aside
      className={`activity-panel activity-panel-${variant}`}
      aria-label="Inspector"
    >
      <header className="activity-panel-header">
        <div>
          <h2 className="activity-panel-title">Inspector</h2>
          <p className="activity-panel-sub">
            {tab === "activity"
              ? isRunActive
                ? `${activeJobLabel || "Processing"}…${queueLength > 0 ? ` (${queueLength} queued)` : ""}`
                : runStateStatus === "failed"
                  ? "Last run failed"
                  : "Idle — runs continue while you navigate"
              : tab === "protocol"
                ? "Protocol paragraphs"
                : tab === "acrf"
                  ? "aCRF summary"
                  : "Artifact versions"}
          </p>
        </div>
        <button
          type="button"
          className="button button-ghost activity-panel-close"
          onClick={onClose}
          aria-label="Close inspector"
        >
          ✕
        </button>
      </header>

      <div className="inspector-tabs" role="tablist" aria-label="Inspector tabs">
        {INSPECTOR_TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            role="tab"
            className={`inspector-tab ${tab === item.id ? "is-active" : ""}`}
            aria-selected={tab === item.id}
            onClick={() => onTabChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div className="inspector-body" role="tabpanel">
        {tab === "protocol" ? (
          studyId.trim() ? (
            <ParagraphViewer
              studyId={studyId}
              focusRef={protocolFocus.focusRef}
              highlightRefs={protocolFocus.highlightRefs}
              height="100%"
            />
          ) : (
            <p className="step7-muted">Select a study to preview protocol paragraphs.</p>
          )
        ) : null}

        {tab === "acrf" ? (
          studyId.trim() ? (
            <AcrfSummaryViewer studyId={studyId} focusHint={acrfFocusHint} />
          ) : (
            <p className="step7-muted">Select a study to preview the aCRF summary.</p>
          )
        ) : null}

        {tab === "versions" ? (
          artifactVersions && artifactVersions.versions.length > 0 ? (
            <ArtifactVersionPicker
              stepId={artifactVersions.stepId}
              versions={artifactVersions.versions}
              activeVersion={artifactVersions.activeVersion}
              stepStatuses={artifactVersions.stepStatuses}
              disabled={artifactVersions.disabled}
              onSelect={artifactVersions.onSelect}
            />
          ) : (
            <p className="step7-muted">
              No artifact versions for this step yet. Run Rules or Deviations extraction first.
            </p>
          )
        ) : null}

        {tab === "activity" ? (
          <>
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
          </>
        ) : null}
      </div>
    </aside>
  );
}
