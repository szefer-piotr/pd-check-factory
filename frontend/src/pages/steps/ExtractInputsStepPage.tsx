import { useMemo, useState } from "react";
import { MarkdownViewer } from "../../components/viewers/MarkdownViewer";
import { JsonViewer } from "../../components/viewers/JsonViewer";
import { PdfViewer } from "../../components/viewers/PdfViewer";
import { StepPage, type StepTabDef } from "../../components/workflow/StepPage";
import { artifactRawPdfUrl, type ArtifactKey, type RawPdfDoc } from "../../services/artifactApi";
import type { Step1PdfExtractor } from "../../services/stepApi";
import { countDetail, dependencyInfos, stepNavStatus, type WorkflowStepPageContext } from "./common";

interface ExtractInputsStepPageProps extends WorkflowStepPageContext {
  extractorChoice: Step1PdfExtractor;
  onExtractorChange: (extractor: Step1PdfExtractor) => void;
  /** Runs the step1 PDF extraction with the chosen extractor. */
  onRunExtraction: (force: boolean) => void;
}

const EXTRACTOR_OPTIONS: Array<{ value: Step1PdfExtractor; label: string; hint: string }> = [
  { value: "opendataloader", label: "OpenDataLoader", hint: "local, fast" },
  { value: "document_intelligence", label: "Document Intelligence", hint: "Azure, layout-aware" },
  { value: "both", label: "Both", hint: "recommended — enables compare" }
];

/** #/extract-inputs — PDF → markdown extraction with per-extractor preview tabs. */
export function ExtractInputsStepPage(props: ExtractInputsStepPageProps): JSX.Element {
  const {
    studyId,
    stepInfo,
    backendStatuses,
    runState,
    isStepRunning,
    runError,
    extractorChoice,
    onExtractorChange,
    onRunExtraction,
    goPrev,
    goNext,
    prevLabel,
    nextLabel,
    tabParam
  } = props;
  const [doc, setDoc] = useState<RawPdfDoc>("protocol");
  const trimmed = studyId.trim();

  const hasOutput = stepInfo?.status === "done";
  const status = stepNavStatus(stepInfo, isStepRunning, Boolean(runError));

  const tabs = useMemo<StepTabDef[]>(() => {
    if (!trimmed) {
      return [];
    }
    const layoutKey = `${doc}-md-layout` as ArtifactKey;
    const odlKey = `${doc}-md-odl` as ArtifactKey;
    return [
      {
        id: "original-pdf",
        label: "Original PDF",
        render: () => <PdfViewer url={artifactRawPdfUrl(trimmed, doc)} />
      },
      {
        id: "di-md",
        label: "DI markdown",
        isArtifact: true,
        render: () => (
          <MarkdownViewer
            studyId={trimmed}
            artifact={layoutKey}
            emptyMessage="Document Intelligence markdown not extracted yet (extractor: DI or Both)."
          />
        )
      },
      {
        id: "odl-md",
        label: "ODL markdown",
        isArtifact: true,
        render: () => (
          <MarkdownViewer
            studyId={trimmed}
            artifact={odlKey}
            emptyMessage="OpenDataLoader markdown not extracted yet (extractor: ODL or Both)."
          />
        )
      },
      {
        id: "compare",
        label: "Compare",
        render: () => (
          <div className="compare-split">
            <div className="compare-pane">
              <p className="compare-pane-title">Original PDF</p>
              <PdfViewer url={artifactRawPdfUrl(trimmed, doc)} />
            </div>
            <div className="compare-pane">
              <p className="compare-pane-title">Extracted markdown ({doc === "protocol" ? "resolved" : "resolved"})</p>
              <MarkdownViewer
                studyId={trimmed}
                artifact={`${doc}-md` as ArtifactKey}
                showOutline={false}
                emptyMessage="No extracted markdown yet."
              />
            </div>
          </div>
        )
      },
      {
        id: "analyze-result",
        label: "analyze_result.json",
        isArtifact: true,
        render: () => (
          <JsonViewer
            studyId={trimmed}
            artifact={`analyze-result:${doc}`}
            emptyMessage="No Document Intelligence raw output for this document (debug artifact)."
          />
        )
      }
    ];
  }, [trimmed, doc]);

  const controls = (
    <div className="extract-inputs-controls">
      <fieldset className="extractor-fieldset">
        <legend className="control-label">PDF extractor</legend>
        <div className="extractor-options">
          {EXTRACTOR_OPTIONS.map((option) => (
            <label key={option.value} className={`extractor-option ${extractorChoice === option.value ? "extractor-option-active" : ""}`}>
              <input
                type="radio"
                name="extractor-choice"
                value={option.value}
                checked={extractorChoice === option.value}
                onChange={() => onExtractorChange(option.value)}
                disabled={isStepRunning}
              />
              <span>
                <strong>{option.label}</strong>
                <span className="step7-muted"> — {option.hint}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <div className="doc-switcher" role="tablist" aria-label="Document">
        {(["protocol", "acrf"] as RawPdfDoc[]).map((value) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={doc === value}
            className={`viewer-tab ${doc === value ? "viewer-tab-active" : ""}`}
            onClick={() => setDoc(value)}
          >
            {value === "protocol" ? "Protocol" : "aCRF"}
          </button>
        ))}
      </div>
      {runError ? <p className="step1-error">{runError}</p> : null}
    </div>
  );

  const runningInfo =
    runState && runState.status === "running" ? (
      <div className="step-running-panel">
        <p className="step1-status">{runState.message || "Extraction running…"}</p>
        {runState.logs.length > 0 ? (
          <pre className="extraction-log-pre step-running-log">
            {runState.logs.slice(-12).map((line) => line.text).join("\n")}
          </pre>
        ) : null}
      </div>
    ) : null;

  return (
    <StepPage
      title="PDF → Markdown"
      description="Convert both PDFs to markdown. Run with 'Both' to compare extractor quality side by side."
      status={status}
      statusDetail={countDetail(stepInfo)}
      onRun={onRunExtraction}
      isRunning={isStepRunning}
      dependencies={dependencyInfos(stepInfo, backendStatuses)}
      hasOutput={hasOutput}
      controls={controls}
      runningInfo={runningInfo}
      tabs={tabs}
      initialTabId={tabParam}
      onPrev={goPrev}
      onNext={goNext}
      prevLabel={prevLabel}
      nextLabel={nextLabel}
    />
  );
}
