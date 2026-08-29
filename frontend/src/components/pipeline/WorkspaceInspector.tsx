import { usePipelineJobs } from "../../jobs/PipelineJobContext";
import { ActivityPanel } from "../pipeline/ActivityPanel";

/** Inline inspector column for Rules / Deviations workspaces. */
export function WorkspaceInspector(): JSX.Element {
  const jobs = usePipelineJobs();
  const open = jobs.activityOpen;

  return (
    <div
      className={`step7-inspector-pane ${open ? "is-open" : ""}`}
      aria-hidden={!open}
    >
      {open ? (
        <ActivityPanel
          variant="column"
          open={open}
          onClose={() => jobs.setActivityOpen(false)}
          tab={jobs.inspectorTab}
          onTabChange={jobs.setInspectorTab}
          studyId={jobs.studyId}
          protocolFocus={jobs.protocolFocus}
          acrfFocusHint={jobs.acrfFocusHint}
          artifactVersions={jobs.artifactVersions}
          isRunActive={jobs.isRunActive}
          activeJobLabel={jobs.activeJobLabel}
          queueLength={jobs.queueLength}
          logs={jobs.logs}
          llmProgress={jobs.llmProgress}
          runStateStatus={jobs.runStateStatus}
        />
      ) : (
        <button
          type="button"
          className="step7-inspector-reopen"
          onClick={() => jobs.openInspector(jobs.inspectorTab || "acrf")}
          aria-label="Open inspector"
          title="Open inspector"
        >
          <span className="step7-inspector-reopen-label">Inspector</span>
        </button>
      )}
    </div>
  );
}
