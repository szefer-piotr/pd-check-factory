import { useCallback, useEffect, useState } from "react";
import { Section } from "../components/layout/Section";
import { ExtractionLiveFeed } from "../components/workflow/ExtractionLiveFeed";
import { PipelineProgressPanel } from "../components/workflow/PipelineProgressPanel";
import { Step7ReviewPanel } from "../components/workflow/Step7ReviewPanel";
import { useStudyContext } from "../hooks/useStudyContext";
import { useStudySettings } from "../hooks/useStudySettings";
import {
  fetchExtractionLive,
  fetchStep1RunState,
  fetchStepStatuses,
  type ExtractionLiveResponse,
  type Step1RunStateResponse,
  type StudySummaryResponse
} from "../services/stepApi";

function isExtractionComplete(
  summary: StudySummaryResponse | null,
  live: ExtractionLiveResponse | null
): boolean {
  const runStatus = live?.runStatus ?? summary?.runState.status ?? "idle";
  if (runStatus === "running" || live?.partial) {
    return false;
  }
  const statuses = summary?.stepStatuses ?? {};
  const workflow = summary?.workflow;
  if (workflow === "map") {
    return statuses["import-pd-spec-map"] === "done";
  }
  if (workflow === "enrich") {
    return statuses["import-pd-spec-enrich"] === "done";
  }
  return statuses["extract-deviations"] === "done" || statuses["extract-deviations"] === "skipped";
}

export function LiveReviewPage(): JSX.Element {
  const { studyId, summary, refresh, pipelineRunner } = useStudyContext();
  const { settings } = useStudySettings(studyId);
  const [live, setLive] = useState<ExtractionLiveResponse | null>(null);
  const [runState, setRunState] = useState<Step1RunStateResponse | null>(null);
  const [nextStepId, setNextStepId] = useState<string | null>(null);
  const [selectedDeviationId, setSelectedDeviationId] = useState<string | null>(null);

  const extractionComplete = isExtractionComplete(summary, live);
  const stepStatuses = summary?.stepStatuses ?? {};
  const showLiveFeed =
    !extractionComplete &&
    runState?.currentSubStepId === "extract-deviations" &&
    (live?.partial ||
      runState?.status === "running" ||
      (live?.deviationCount ?? 0) > 0 ||
      (live?.ruleCount ?? 0) > 0);

  const onStepStatusesChange = useCallback(() => {
    void refresh();
  }, [refresh]);

  const handleContinuePipeline = useCallback(() => {
    void pipelineRunner.runRemaining();
  }, [pipelineRunner]);

  useEffect(() => {
    if (!studyId.trim()) {
      setLive(null);
      setRunState(null);
      setNextStepId(null);
      return;
    }
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const [liveResponse, runStateResponse, statuses] = await Promise.all([
          fetchExtractionLive(studyId.trim()),
          fetchStep1RunState(studyId.trim()),
          fetchStepStatuses(studyId.trim())
        ]);
        if (!cancelled) {
          setLive(liveResponse);
          setRunState(runStateResponse);
          setNextStepId(statuses.nextStepId);
        }
      } catch {
        // best-effort polling
      }
    };
    void poll();
    const timer = window.setInterval(() => void poll(), 2500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [studyId]);

  return (
    <Section className="section-flat">
      {pipelineRunner.lastError ? (
        <p className="step1-error" role="alert">
          {pipelineRunner.lastError}
        </p>
      ) : null}
      <PipelineProgressPanel
        runState={runState}
        stepStatuses={stepStatuses}
        extractionComplete={extractionComplete}
        nextStepId={nextStepId}
        onContinuePipeline={handleContinuePipeline}
        pipelineRunning={pipelineRunner.isRunning}
        extractionDeployment={settings.extractionDeployment || undefined}
        acrfSummaryDeployment={settings.acrfSummaryDeployment || undefined}
        liveLlmProgress={live?.llmProgress}
        ruleCount={live?.ruleCount ?? 0}
        completedRuleIds={live?.completedRuleIds ?? []}
      />
      {showLiveFeed ? (
        <ExtractionLiveFeed
          studyId={studyId}
          active={!extractionComplete}
          live={live}
          runState={runState}
          onSelectDeviation={setSelectedDeviationId}
        />
      ) : null}
      {extractionComplete ? (
        <Step7ReviewPanel
          studyId={studyId}
          onStepStatusesChange={onStepStatusesChange}
          selectedDeviationId={selectedDeviationId}
          onSelectedDeviationIdChange={setSelectedDeviationId}
        />
      ) : null}
    </Section>
  );
}
