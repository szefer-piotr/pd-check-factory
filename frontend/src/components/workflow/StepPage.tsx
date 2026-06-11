import { useEffect, useState, type ReactNode } from "react";
import type { StepNavStatus } from "./StepNavigation";

export interface StepTabDef {
  id: string;
  label: string;
  /** Marked tabs also render as artifact chips in the step header. */
  isArtifact?: boolean;
  render: () => ReactNode;
}

export interface StepDependencyInfo {
  stepId: string;
  label: string;
  done: boolean;
}

interface StepPageProps {
  title: string;
  description?: string;
  status: StepNavStatus;
  /** e.g. "42 rules". */
  statusDetail?: string;
  lastRunAt?: string;
  /** Run / Re-run handler; omit for pages without a backend step (upload, coding). */
  onRun?: (force: boolean) => void;
  isRunning?: boolean;
  dependencies?: StepDependencyInfo[];
  /** When false, the preview region shows the "Not run yet" empty state. */
  hasOutput: boolean;
  banner?: ReactNode;
  /** Step-specific controls rendered between header and preview region. */
  controls?: ReactNode;
  /** Live progress UI shown while the step is running. */
  runningInfo?: ReactNode;
  tabs: StepTabDef[];
  initialTabId?: string;
  onPrev?: () => void;
  onNext?: () => void;
  prevLabel?: string;
  nextLabel?: string;
}

const STATUS_LABELS: Record<StepNavStatus, string> = {
  pending: "Not run",
  running: "Running…",
  done: "Done",
  failed: "Failed",
  skipped: "Skipped"
};

/**
 * Universal step-page template: header (title, status pill, run buttons, artifact
 * chips), controls, full-height tabbed preview region, and a sticky prev/next footer.
 */
export function StepPage({
  title,
  description,
  status,
  statusDetail,
  lastRunAt,
  onRun,
  isRunning = false,
  dependencies = [],
  hasOutput,
  banner,
  controls,
  runningInfo,
  tabs,
  initialTabId,
  onPrev,
  onNext,
  prevLabel,
  nextLabel
}: StepPageProps): JSX.Element {
  const [activeTabId, setActiveTabId] = useState(initialTabId ?? tabs[0]?.id ?? "");
  const [isFullscreen, setIsFullscreen] = useState(false);

  useEffect(() => {
    if (initialTabId) {
      setActiveTabId(initialTabId);
    }
    // Only react to deep-link changes, not tab list identity churn.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTabId]);

  useEffect(() => {
    if (tabs.length > 0 && !tabs.some((tab) => tab.id === activeTabId)) {
      setActiveTabId(tabs[0].id);
    }
  }, [tabs, activeTabId]);

  const unmetDependencies = dependencies.filter((dependency) => !dependency.done);
  const runBlocked = unmetDependencies.length > 0;
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  const artifactTabs = tabs.filter((tab) => tab.isArtifact);

  const previewRegion = (
    <div className={`step-preview-region ${isFullscreen ? "step-preview-region-fullscreen" : ""}`}>
      {tabs.length > 1 || isFullscreen ? (
        <div className="step-preview-tabbar">
          <div className="viewer-tab-row" role="tablist" aria-label="Artifact previews">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.id === activeTab?.id}
                className={`viewer-tab ${tab.id === activeTab?.id ? "viewer-tab-active" : ""}`}
                onClick={() => setActiveTabId(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="button button-ghost step-preview-expand"
            onClick={() => setIsFullscreen((value) => !value)}
          >
            {isFullscreen ? "Exit full screen" : "Full screen"}
          </button>
        </div>
      ) : null}
      <div className="step-preview-content">{activeTab ? activeTab.render() : null}</div>
    </div>
  );

  return (
    <section className="step-page" aria-label={title}>
      <header className="step-page-header">
        <div className="step-page-heading">
          <h2 className="step-page-title">{title}</h2>
          <span className={`step-status-pill step-status-pill-${status}`}>
            {STATUS_LABELS[status]}
            {statusDetail ? ` · ${statusDetail}` : ""}
          </span>
          {lastRunAt ? (
            <span className="step7-muted step-page-lastrun">Last run {new Date(lastRunAt).toLocaleString()}</span>
          ) : null}
        </div>
        <div className="step-page-header-actions">
          {artifactTabs.length > 0 && hasOutput ? (
            <span className="step-artifact-chips">
              {artifactTabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  className={`artifact-chip ${tab.id === activeTab?.id ? "artifact-chip-active" : ""}`}
                  onClick={() => setActiveTabId(tab.id)}
                  title={`Open ${tab.label}`}
                >
                  {tab.label}
                </button>
              ))}
            </span>
          ) : null}
          {onRun ? (
            <span className="step-page-run-buttons">
              <button
                type="button"
                className="button button-primary"
                onClick={() => onRun(false)}
                disabled={isRunning || runBlocked}
              >
                {isRunning ? "Running…" : hasOutput ? "Run again" : "Run"}
              </button>
              {hasOutput ? (
                <button
                  type="button"
                  className="button button-secondary"
                  onClick={() => onRun(true)}
                  disabled={isRunning || runBlocked}
                  title="Force re-run even though outputs exist"
                >
                  Re-run (force)
                </button>
              ) : null}
            </span>
          ) : null}
        </div>
      </header>
      {description ? <p className="step7-muted step-page-description">{description}</p> : null}
      {banner}
      {controls ? <div className="step-page-controls">{controls}</div> : null}
      {isRunning && runningInfo ? <div className="step-page-running">{runningInfo}</div> : null}

      {hasOutput || tabs.length === 0 ? (
        previewRegion
      ) : (
        <div className="step-empty-state">
          <p className="step-empty-title">Not run yet.</p>
          {dependencies.length > 0 ? (
            <p className="step-empty-deps">
              Requires:{" "}
              {dependencies.map((dependency, index) => (
                <span key={dependency.stepId} className={`dep-chip ${dependency.done ? "dep-chip-done" : "dep-chip-missing"}`}>
                  {dependency.label} {dependency.done ? "✓" : "✗"}
                  {index < dependencies.length - 1 ? "" : ""}
                </span>
              ))}
            </p>
          ) : null}
          {runBlocked ? (
            <p className="step7-muted">Complete the missing dependencies, then run this step.</p>
          ) : onRun ? (
            <p className="step7-muted">All dependencies are ready — you can run this step now.</p>
          ) : null}
        </div>
      )}

      <footer className="step-page-footer">
        <button type="button" className="button button-secondary" onClick={onPrev} disabled={!onPrev}>
          ← {prevLabel ?? "Previous"}
        </button>
        <span className="step7-muted step-page-footer-hint">Use ← / → keys to move between steps</span>
        <button type="button" className="button button-secondary" onClick={onNext} disabled={!onNext}>
          {nextLabel ?? "Next"} →
        </button>
      </footer>
    </section>
  );
}
