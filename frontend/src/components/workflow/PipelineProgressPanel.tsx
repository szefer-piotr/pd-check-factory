import { useMemo } from "react";
import { LlmProgressBar } from "./LlmProgressBar";
import type { LlmProgress, PipelineLogLine, Step1RunStateResponse } from "../../services/stepApi";
import { stepLabel } from "../../utils/processingSteps";

const OCR_LOG_TAGS = ["Document Intelligence", "OpenDataLoader", "opendataloader"] as const;

type PipelinePhase = "ocr" | "preparing" | "acrf-summary" | "extract-rules" | "extract-deviations";

const PHASE_ORDER: PipelinePhase[] = [
  "ocr",
  "preparing",
  "acrf-summary",
  "extract-rules",
  "extract-deviations"
];

const PHASE_LABELS: Record<PipelinePhase, string> = {
  ocr: "OCR",
  preparing: "Preparing documents",
  "acrf-summary": "ACRF summary",
  "extract-rules": "Extract rules",
  "extract-deviations": "Generate deviations"
};

const SUB_STEP_TO_PHASE: Record<string, PipelinePhase> = {
  "extract-inputs": "ocr",
  "index-protocol": "preparing",
  "acrf-split-toc": "preparing",
  "acrf-summary-text": "acrf-summary",
  "extract-rules": "extract-rules",
  "extract-deviations": "extract-deviations"
};

interface PipelineProgressPanelProps {
  runState: Step1RunStateResponse | null;
  stepStatuses: Record<string, string>;
  extractionComplete: boolean;
  nextStepId?: string | null;
  onContinuePipeline?: () => void;
  pipelineRunning?: boolean;
  extractionDeployment?: string;
  acrfSummaryDeployment?: string;
  liveLlmProgress?: LlmProgress | null;
  ruleCount?: number;
  completedRuleIds?: string[];
}

function logTag(text: string): string | null {
  for (const tag of OCR_LOG_TAGS) {
    if (text.includes(tag)) {
      return tag === "opendataloader" ? "OpenDataLoader" : tag;
    }
  }
  return null;
}

function resolveActivePhase(currentSubStepId: string): PipelinePhase {
  return SUB_STEP_TO_PHASE[currentSubStepId] ?? "preparing";
}

function resolveOcrHeadline(runState: Step1RunStateResponse): string {
  const message = runState.message ?? "";
  if (/reading protocol/i.test(message)) {
    return "Reading protocol…";
  }
  if (/reading acrf/i.test(message)) {
    return "Reading aCRF…";
  }

  const logs = runState.logs ?? [];
  for (let index = logs.length - 1; index >= 0; index -= 1) {
    const text = logs[index]?.text ?? "";
    if (text.includes("aCRF OCR")) {
      return "Reading aCRF…";
    }
    if (text.includes("Protocol OCR")) {
      return "Reading protocol…";
    }
  }

  return "Reading documents…";
}

function resolveLlmProgress(
  runState: Step1RunStateResponse | null,
  liveLlmProgress?: LlmProgress | null,
  activePhase?: PipelinePhase
): LlmProgress | null {
  const runProgress = runState?.llmProgress ?? null;
  if (
    runProgress &&
    (activePhase === "acrf-summary" || activePhase === "extract-deviations")
  ) {
    return runProgress;
  }
  if (liveLlmProgress?.phase === "extract-deviations") {
    return liveLlmProgress;
  }
  return runProgress;
}

function isPhaseComplete(
  phase: PipelinePhase,
  stepStatuses: Record<string, string>,
  activePhase: PipelinePhase
): boolean {
  const activeIndex = PHASE_ORDER.indexOf(activePhase);
  const phaseIndex = PHASE_ORDER.indexOf(phase);
  if (phaseIndex < activeIndex) {
    return true;
  }
  if (phase === "ocr") {
    return stepStatuses["extract-inputs"] === "done" || stepStatuses["extract-inputs"] === "skipped";
  }
  if (phase === "preparing") {
    return (
      (stepStatuses["index-protocol"] === "done" || stepStatuses["index-protocol"] === "skipped") &&
      (stepStatuses["acrf-split-toc"] === "done" || stepStatuses["acrf-split-toc"] === "skipped")
    );
  }
  if (phase === "acrf-summary") {
    return stepStatuses["acrf-summary-text"] === "done" || stepStatuses["acrf-summary-text"] === "skipped";
  }
  if (phase === "extract-rules") {
    return stepStatuses["extract-rules"] === "done" || stepStatuses["extract-rules"] === "skipped";
  }
  return stepStatuses["extract-deviations"] === "done" || stepStatuses["extract-deviations"] === "skipped";
}

export function PipelineProgressPanel({
  runState,
  stepStatuses,
  extractionComplete,
  nextStepId = null,
  onContinuePipeline,
  pipelineRunning = false,
  extractionDeployment,
  acrfSummaryDeployment,
  liveLlmProgress,
  ruleCount = 0,
  completedRuleIds = []
}: PipelineProgressPanelProps): JSX.Element | null {
  const status = runState?.status ?? "idle";
  const currentSubStepId = runState?.currentSubStepId ?? "";
  const stalledBetweenSteps =
    !extractionComplete &&
    !pipelineRunning &&
    status !== "running" &&
    Boolean(nextStepId) &&
    nextStepId !== "review-and-finalize";
  const activePhase = stalledBetweenSteps
    ? resolveActivePhase(nextStepId ?? currentSubStepId)
    : resolveActivePhase(currentSubStepId);

  const visible =
    !extractionComplete || (status === "failed" && Boolean(runState?.error));

  const llmProgress = useMemo(
    () => resolveLlmProgress(runState, liveLlmProgress, activePhase),
    [runState, liveLlmProgress, activePhase]
  );

  const allLogs = useMemo(() => runState?.logs ?? [], [runState?.logs]);

  const completedPhases = useMemo(
    () =>
      PHASE_ORDER.filter(
        (phase) => phase !== activePhase && isPhaseComplete(phase, stepStatuses, activePhase)
      ),
    [activePhase, stepStatuses]
  );

  if (!visible || !runState) {
    return null;
  }

  const showOcrSpinner = activePhase === "ocr" && stepStatuses["extract-inputs"] !== "done";
  const showRulesSpinner =
    activePhase === "extract-rules" && stepStatuses["extract-rules"] !== "done";
  const showPreparingSpinner =
    activePhase === "preparing" &&
    (stepStatuses["index-protocol"] !== "done" || stepStatuses["acrf-split-toc"] !== "done");

  const deploymentLabel =
    activePhase === "acrf-summary" && acrfSummaryDeployment
      ? acrfSummaryDeployment
      : (activePhase === "extract-rules" || activePhase === "extract-deviations") &&
          extractionDeployment
        ? extractionDeployment
        : null;

  const deviationsTotal = ruleCount > 0 ? ruleCount : (llmProgress?.total ?? 0);
  const deviationsCurrent =
    llmProgress?.phase === "extract-deviations"
      ? llmProgress.current
      : completedRuleIds.length;

  return (
    <section className="extraction-status-panel pipeline-progress-panel" aria-label="Extraction progress">
      <header className="pipeline-progress-panel-header">
        <h3 className="pipeline-progress-panel-title">Extraction in progress</h3>
        {status === "running" || !extractionComplete ? (
          <span className="pipeline-progress-panel-live" aria-live="polite">
            Live
          </span>
        ) : null}
      </header>

      {status === "failed" && runState.error ? (
        <p className="pipeline-progress-error" role="alert">
          {runState.error}
        </p>
      ) : null}

      {stalledBetweenSteps && nextStepId ? (
        <div className="pipeline-progress-stalled" role="status">
          <p className="pipeline-progress-phase-detail">
            Up next: <strong>{stepLabel(nextStepId)}</strong>
          </p>
          {onContinuePipeline ? (
            <button
              className="button button-primary"
              type="button"
              onClick={onContinuePipeline}
              disabled={pipelineRunning}
            >
              Continue pipeline
            </button>
          ) : null}
        </div>
      ) : null}

      {completedPhases.length > 0 ? (
        <details className="pipeline-progress-completed">
          <summary>Completed ({completedPhases.length})</summary>
          <ul className="pipeline-progress-completed-list">
            {completedPhases.map((phase) => (
              <li key={phase}>{PHASE_LABELS[phase]}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <div className="pipeline-progress-phase-card" aria-current="step">
        <h4 className="pipeline-progress-phase-title">{PHASE_LABELS[activePhase]}</h4>

        {activePhase === "ocr" ? (
          <>
            <div className="pipeline-progress-indeterminate" role="status">
              {showOcrSpinner ? <span className="upload-spinner" aria-hidden="true" /> : null}
              <span>{resolveOcrHeadline(runState)}</span>
            </div>
            {allLogs.length > 0 ? (
              <details className="extraction-log-details" open>
                <summary>Activity log</summary>
                <ul className="pipeline-progress-log-list pipeline-progress-log-list-full">
                  {allLogs.map((line: PipelineLogLine, index) => {
                    const tag = logTag(line.text);
                    return (
                      <li key={`${line.ts}-${index}`} className="pipeline-progress-log-line">
                        {tag ? <span className="pipeline-progress-log-tag">{tag}</span> : null}
                        <span className="pipeline-progress-log-text">{line.text}</span>
                      </li>
                    );
                  })}
                </ul>
              </details>
            ) : null}
          </>
        ) : null}

        {activePhase === "preparing" ? (
          <div className="pipeline-progress-indeterminate" role="status">
            {showPreparingSpinner ? <span className="upload-spinner" aria-hidden="true" /> : null}
            <span>Preparing documents…</span>
          </div>
        ) : null}

        {activePhase === "acrf-summary" ? (
          <>
            {llmProgress && llmProgress.total > 0 ? (
              <p className="pipeline-progress-phase-detail">
                Summarizing {llmProgress.total} sections
              </p>
            ) : null}
            {llmProgress ? <LlmProgressBar progress={llmProgress} /> : null}
          </>
        ) : null}

        {activePhase === "extract-rules" ? (
          <div className="pipeline-progress-indeterminate" role="status">
            {showRulesSpinner ? <span className="upload-spinner" aria-hidden="true" /> : null}
            <span>
              Extracting rules… <strong>{ruleCount}</strong> rules found
            </span>
          </div>
        ) : null}

        {activePhase === "extract-deviations" ? (
          <>
            {deviationsTotal > 0 ? (
              <p className="pipeline-progress-phase-detail">
                Creating deviations for {deviationsTotal} rules
              </p>
            ) : null}
            {llmProgress && llmProgress.total > 0 ? (
              <LlmProgressBar progress={llmProgress} />
            ) : deviationsTotal > 0 ? (
              <LlmProgressBar
                progress={{
                  phase: "extract-deviations",
                  current: deviationsCurrent,
                  total: deviationsTotal,
                  unit: "rules"
                }}
              />
            ) : null}
          </>
        ) : null}

        {deploymentLabel ? (
          <p className="pipeline-progress-phase-deployment">LLM: {deploymentLabel}</p>
        ) : null}
      </div>
    </section>
  );
}
