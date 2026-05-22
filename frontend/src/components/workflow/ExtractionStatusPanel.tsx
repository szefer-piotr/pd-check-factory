import { useEffect, useMemo } from "react";
import type { ExtractionRunState } from "../../hooks/useStudyPipelineState";
import { fetchStep1RunState } from "../../services/stepApi";
import type { ProcessingSubProgressItem } from "./ProcessingPanel";

interface ExtractionStatusPanelProps {
  extraction: ExtractionRunState;
  processingProgress: ProcessingSubProgressItem[];
  isProcessing: boolean;
  processingMessage: string;
  processingError: string;
  studyId?: string;
  pollRunStateDuringExtract?: boolean;
  simplified?: boolean;
  onRunStatePolled?: (runState: {
    logs: ExtractionRunState["logs"];
    message: string;
    currentSubStepId: string;
    currentStage: string;
  }) => void;
}

const STAGE_LABELS: Record<string, string> = {
  upload: "Preparing documents",
  extract: "Extracting PDFs (Document Intelligence / OCR)",
  index: "Indexing protocol",
  acrf_split: "Splitting aCRF TOC",
  acrf_merge: "Merging aCRF summary",
  rules: "Extracting rules",
  deviations: "Generating deviations",
  finalize: "Finalizing",
  complete: "Complete"
};

const SUB_STEP_LABELS: Record<string, string> = {
  "extract-inputs": "Extract PDFs to markdown",
  "index-protocol": "Build paragraph index",
  "acrf-split-toc": "Split aCRF sections",
  "acrf-summary-text": "Merge aCRF summary text",
  "extract-rules": "Extract protocol rules",
  "extract-deviations": "Extract deviation candidates"
};

type DiMilestoneId = "di_protocol" | "di_acrf" | "odl_protocol" | "odl_acrf";

const DI_MILESTONE_LABELS: Record<DiMilestoneId, string> = {
  di_protocol: "Document Intelligence — protocol",
  di_acrf: "Document Intelligence — aCRF",
  odl_protocol: "OpenDataLoader — protocol",
  odl_acrf: "OpenDataLoader — aCRF"
};

function resolveDiMilestoneStatus(
  logs: ExtractionRunState["logs"],
  milestoneId: DiMilestoneId
): "pending" | "running" | "done" {
  const patterns: Record<DiMilestoneId, { start: string; done: string }> = {
    di_protocol: { start: "di: analyzing protocol", done: "di: protocol complete" },
    di_acrf: { start: "di: analyzing acrf", done: "di: acrf complete" },
    odl_protocol: { start: "opendataloader: protocol", done: "opendataloader: protocol complete" },
    odl_acrf: { start: "opendataloader: acrf", done: "opendataloader: acrf complete" }
  };
  const pattern = patterns[milestoneId];
  const texts = logs.map((line) => line.text.toLowerCase());
  if (texts.some((text) => text.includes(pattern.done))) {
    return "done";
  }
  if (texts.some((text) => text.includes(pattern.start))) {
    return "running";
  }
  return "pending";
}

export function ExtractionStatusPanel({
  extraction,
  processingProgress,
  isProcessing,
  processingMessage,
  processingError,
  studyId = "",
  pollRunStateDuringExtract = false,
  simplified = false,
  onRunStatePolled
}: ExtractionStatusPanelProps): JSX.Element | null {
  const showPanel =
    isProcessing ||
    extraction.status !== "idle" ||
    processingProgress.some((item) => item.status !== "pending") ||
    Boolean(processingMessage || processingError);

  const onExtractInputs =
    isProcessing &&
    (extraction.currentSubStepId === "extract-inputs" || processingProgress.find((p) => p.stepId === "extract-inputs")?.status === "running");

  useEffect(() => {
    if (!pollRunStateDuringExtract || !onExtractInputs || !studyId.trim()) {
      return;
    }
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const runState = await fetchStep1RunState(studyId.trim());
        if (!cancelled) {
          onRunStatePolled?.({
            logs: runState.logs,
            message: runState.message,
            currentSubStepId: runState.currentSubStepId,
            currentStage: runState.currentStage
          });
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
  }, [pollRunStateDuringExtract, onExtractInputs, studyId, onRunStatePolled]);

  const diMilestones = useMemo(() => {
    if (!onExtractInputs && extraction.logs.length === 0) {
      return [];
    }
    return (Object.keys(DI_MILESTONE_LABELS) as DiMilestoneId[]).map((id) => ({
      id,
      label: DI_MILESTONE_LABELS[id],
      status: resolveDiMilestoneStatus(extraction.logs, id)
    }));
  }, [extraction.logs, onExtractInputs]);

  if (!showPanel) {
    return null;
  }

  const stageLabel =
    STAGE_LABELS[extraction.currentStage] ||
    STAGE_LABELS[processingMessage ? "extract" : ""] ||
    (isProcessing ? "Running extraction pipeline" : "");
  const subStepLabel = SUB_STEP_LABELS[extraction.currentSubStepId] ?? extraction.currentSubStepId;

  const allLogs = [
    ...extraction.logs,
    ...processingProgress
      .filter((item) => item.message && item.message !== "Waiting")
      .map((item) => ({
        ts: "",
        level: item.status === "failed" ? ("error" as const) : ("info" as const),
        text: `${item.title}: ${item.message}`
      }))
  ];

  const statusLine =
    subStepLabel && (isProcessing || extraction.status === "running")
      ? `${stageLabel || "Running"} — ${subStepLabel}`
      : stageLabel || processingMessage || extraction.message;

  return (
    <section
      className={`extraction-status-panel ${simplified ? "extraction-status-panel-simplified" : ""}`}
      aria-label="Extraction status"
    >
      {isProcessing || extraction.status === "running" ? (
        <div className="extraction-wait-banner" role="status">
          <span className="step1-extraction-circle" aria-hidden="true" />
          <div>
            <strong>{simplified ? "Running pipeline…" : "Please wait — processing is in progress"}</strong>
            {!simplified ? (
              <p className="step7-muted">This step can take several minutes, especially Document Intelligence extraction.</p>
            ) : null}
          </div>
        </div>
      ) : null}

      {simplified && statusLine ? (
        <p className="extraction-stage-line extraction-stage-line-simple">{statusLine}</p>
      ) : null}

      {!simplified && stageLabel ? (
        <p className="extraction-stage-line">
          <span className="extraction-stage-label">Current stage:</span> {stageLabel}
        </p>
      ) : null}
      {!simplified && subStepLabel && (isProcessing || extraction.status === "running") ? (
        <p className="extraction-substep-line">
          <span className="extraction-stage-label">Sub-step:</span> {subStepLabel}
        </p>
      ) : null}

      {!simplified && diMilestones.some((m) => m.status !== "pending") ? (
        <div className="extraction-di-milestones" aria-label="PDF extraction milestones">
          {diMilestones.map((milestone) =>
            milestone.status === "pending" ? null : (
              <div className="auto-run-step" key={milestone.id}>
                <span className={`auto-run-circle auto-run-circle-${milestone.status}`} aria-hidden="true" />
                <div>
                  <span className="auto-run-title">{milestone.label}</span>
                  <span className="auto-run-message">{milestone.status === "done" ? "Complete" : "In progress…"}</span>
                </div>
              </div>
            )
          )}
        </div>
      ) : null}

      {processingMessage || extraction.message ? (
        <p className="step1-status">{processingMessage || extraction.message}</p>
      ) : null}
      {processingError || extraction.error ? (
        <p className="step1-error">{processingError || extraction.error}</p>
      ) : null}

      {extraction.status === "failed" && !isProcessing ? (
        <p className="step1-error">Extraction failed. Review the log below and try again.</p>
      ) : null}

      {extraction.status === "done" && !isProcessing ? (
        <p className="step1-status">Extraction completed. You can continue to review when ready.</p>
      ) : null}

      <div className={`auto-run-progress ${simplified ? "auto-run-progress-compact" : ""}`} aria-live="polite">
        {processingProgress.map((item) => (
          <div className="auto-run-step" key={item.stepId}>
            <span className={`auto-run-circle auto-run-circle-${item.status}`} aria-hidden="true">
              {item.status === "failed" ? "!" : ""}
            </span>
            <div>
              <span className="auto-run-title">{item.title}</span>
              <span className="auto-run-message">{item.message}</span>
            </div>
          </div>
        ))}
      </div>

      {allLogs.length > 0 ? (
        <details className="extraction-log-details" open={isProcessing}>
          <summary>Processing log ({allLogs.length} lines)</summary>
          <pre className="extraction-log-pre">
            {allLogs
              .slice(-80)
              .map((line) => (line.ts ? `[${line.ts}] ${line.text}` : line.text))
              .join("\n")}
          </pre>
        </details>
      ) : null}
    </section>
  );
}
