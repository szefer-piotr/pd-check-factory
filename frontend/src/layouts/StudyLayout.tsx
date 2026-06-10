import { useState } from "react";
import { Link, Outlet, useParams } from "react-router-dom";
import { PipelineStatusDrawer } from "../components/workflow/PipelineStatusDrawer";
import { WorkflowStageNav } from "../components/workflow/WorkflowStageNav";
import { Page } from "../components/layout/Page";
import { Section } from "../components/layout/Section";
import { Stack } from "../components/layout/Stack";
import { StudyProvider } from "../context/StudyContext";
import { usePipelineRunner } from "../hooks/usePipelineRunner";
import { useStudySettings } from "../hooks/useStudySettings";
import { useStudySummary } from "../hooks/useStudySummary";
import { syncStudy } from "../services/stepApi";

export function StudyLayout(): JSX.Element {
  const { studyId = "" } = useParams();
  const { summary, isLoading, error, refresh } = useStudySummary(studyId);
  const { settings } = useStudySettings(studyId);
  const pipelineRunner = usePipelineRunner(studyId, summary?.workflow, settings, refresh);
  const [syncMessage, setSyncMessage] = useState("");
  const [syncError, setSyncError] = useState("");
  const [isSyncing, setIsSyncing] = useState(false);

  const counts = summary?.deviationCounts;

  async function handleSync(): Promise<void> {
    const trimmed = studyId.trim();
    if (!trimmed || isSyncing) {
      return;
    }
    setSyncError("");
    setSyncMessage("");
    setIsSyncing(true);
    try {
      await syncStudy(trimmed);
      setSyncMessage("Study synced from cloud storage.");
      await refresh();
    } catch (syncFailure) {
      setSyncError(syncFailure instanceof Error ? syncFailure.message : "Unable to sync study.");
    } finally {
      setIsSyncing(false);
    }
  }

  return (
    <StudyProvider
      value={{
        studyId,
        summary,
        isLoading,
        error,
        refresh,
        pipelineRunner
      }}
    >
      <Page>
        <Stack gap="lg">
          <Section className="section-flat">
            <header className="hero hero-tight study-bar">
              <div className="study-bar-main">
                <Link className="study-bar-back" to="/welcome">
                  Rho PD Assurance
                </Link>
                <h1 className="study-bar-title">{studyId}</h1>
              </div>
              <WorkflowStageNav
                studyId={studyId}
                workflow={summary?.workflow}
                uiStage={summary?.uiStage}
                stepStatuses={summary?.stepStatuses ?? {}}
              />
              <div className="study-chips">
                <span className="chip">
                  Total <strong>{counts?.total ?? "—"}</strong>
                </span>
                <span className="chip">
                  Accepted <strong>{counts?.accepted ?? "—"}</strong>
                </span>
                <span className="chip">
                  To review <strong>{counts?.to_review ?? "—"}</strong>
                </span>
                <button
                  className="button button-secondary button-small"
                  type="button"
                  onClick={() => void handleSync()}
                  disabled={isSyncing || !studyId.trim()}
                >
                  {isSyncing ? "Syncing…" : "Sync"}
                </button>
              </div>
              {syncMessage ? <p className="step1-status">{syncMessage}</p> : null}
              {syncError ? <p className="step1-error">{syncError}</p> : null}
              {error ? <p className="step1-error">{error}</p> : null}
              {isLoading ? <p className="step7-muted">Loading study…</p> : null}
            </header>
          </Section>
          <Outlet />
        </Stack>
        <PipelineStatusDrawer />
      </Page>
    </StudyProvider>
  );
}
