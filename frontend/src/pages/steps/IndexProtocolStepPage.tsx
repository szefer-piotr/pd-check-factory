import { useMemo } from "react";
import { JsonViewer } from "../../components/viewers/JsonViewer";
import { ParagraphViewer } from "../../components/viewers/ParagraphViewer";
import { StepPage, type StepTabDef } from "../../components/workflow/StepPage";
import type { ParagraphIndexJson } from "../../services/artifactApi";
import { countDetail, dependencyInfos, stepNavStatus, type WorkflowStepPageContext } from "./common";

function ParagraphIndexTable(data: unknown): JSX.Element {
  const index = data as ParagraphIndexJson;
  const paragraphs = index.paragraphs ?? [];
  return (
    <div className="rendered-table-wrap">
      <table className="rendered-table">
        <thead>
          <tr>
            <th>id</th>
            <th>char range</th>
            <th>first 80 chars</th>
          </tr>
        </thead>
        <tbody>
          {paragraphs.map((paragraph) => (
            <tr key={paragraph.paragraph_id}>
              <td className="rendered-table-mono">{paragraph.paragraph_id}</td>
              <td className="rendered-table-mono">
                {paragraph.char_start}–{paragraph.char_end}
              </td>
              <td>{paragraph.text.slice(0, 80)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** #/index-protocol — the canonical numbered paragraph viewer. */
export function IndexProtocolStepPage(props: WorkflowStepPageContext): JSX.Element {
  const {
    studyId,
    stepInfo,
    backendStatuses,
    isStepRunning,
    runError,
    onRun,
    goPrev,
    goNext,
    prevLabel,
    nextLabel,
    focus,
    tabParam
  } = props;
  const trimmed = studyId.trim();
  const hasOutput = stepInfo?.status === "done";
  const status = stepNavStatus(stepInfo, isStepRunning, Boolean(runError));

  const tabs = useMemo<StepTabDef[]>(() => {
    if (!trimmed) {
      return [];
    }
    return [
      {
        id: "paragraphs",
        label: "Paragraphs",
        isArtifact: true,
        render: () => <ParagraphViewer studyId={trimmed} focusRef={focus} />
      },
      {
        id: "paragraph-index-json",
        label: "paragraph_index.json",
        isArtifact: true,
        render: () => (
          <JsonViewer
            studyId={trimmed}
            artifact="paragraph-index"
            renderRendered={(data) => ParagraphIndexTable(data)}
            renderedLabel="Table"
          />
        )
      }
    ];
  }, [trimmed, focus]);

  return (
    <StepPage
      title="Paragraph index"
      description="Every protocol paragraph gets a stable p# anchor. Rules and deviations link back to these anchors."
      status={status}
      statusDetail={countDetail(stepInfo)}
      onRun={onRun}
      isRunning={isStepRunning}
      dependencies={dependencyInfos(stepInfo, backendStatuses)}
      hasOutput={hasOutput}
      banner={runError ? <p className="step1-error">{runError}</p> : undefined}
      tabs={tabs}
      initialTabId={focus ? "paragraphs" : tabParam}
      onPrev={goPrev}
      onNext={goNext}
      prevLabel={prevLabel}
      nextLabel={nextLabel}
    />
  );
}
