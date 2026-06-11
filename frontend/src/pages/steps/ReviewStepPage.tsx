import { useCallback, useMemo, useState } from "react";
import { JsonViewer } from "../../components/viewers/JsonViewer";
import { Step7ReviewPanel } from "../../components/workflow/Step7ReviewPanel";
import { StepPage, type StepTabDef } from "../../components/workflow/StepPage";
import type { Step7DeviationRow, StepStatus } from "../../services/stepApi";
import { countDetail, dependencyInfos, stepNavStatus, type WorkflowStepPageContext } from "./common";

interface ReviewStepPageProps extends WorkflowStepPageContext {
  onStepStatusesChange: (statuses: Record<string, StepStatus>) => void;
  onAcceptAndContinue: () => void;
  isAcceptingCoding: boolean;
  codingAcceptError: string;
}

interface PseudoLogicItem {
  deviation_id: string;
  rule_id: string;
  rule_title?: string;
  pseudo_logic: string;
  programmable?: boolean | null;
  programmability_note?: string;
}

function PseudoLogicRendered(data: unknown): JSX.Element {
  const items = ((data as { items?: PseudoLogicItem[] }).items ?? []) as PseudoLogicItem[];
  if (items.length === 0) {
    return <p className="step7-muted">No pseudo logic generated yet.</p>;
  }
  return (
    <div className="pseudo-logic-list">
      {items.map((item) => (
        <article key={item.deviation_id} className="pseudo-logic-card">
          <header className="pseudo-logic-card-header">
            <span className="rule-card-id">{item.deviation_id}</span>
            <span className="step7-muted">
              {item.rule_id}
              {item.rule_title ? ` — ${item.rule_title}` : ""}
            </span>
            {item.programmable !== null && item.programmable !== undefined ? (
              <span className={`step7-pill step7-pill-${item.programmable ? "yes" : "no"}`}>
                programmable: {item.programmable ? "yes" : "no"}
              </span>
            ) : null}
          </header>
          <pre className="step7-drawer-code">{item.pseudo_logic}</pre>
          {item.programmability_note ? <p className="step7-muted">{item.programmability_note}</p> : null}
        </article>
      ))}
    </div>
  );
}

interface FinalDeviationItem {
  deviation_id?: string;
  rule_id?: string;
  rule_title?: string;
  deviation_text?: string;
  text?: string;
  status?: string;
  programmable?: boolean | null;
  pseudo_logic?: string;
}

function FinalDeviationsTable(data: unknown): JSX.Element {
  const items = ((data as { items?: FinalDeviationItem[] }).items ?? []) as FinalDeviationItem[];
  if (items.length === 0) {
    return <p className="step7-muted">No final rows yet — run finalize.</p>;
  }
  return (
    <div className="rendered-table-wrap">
      <table className="rendered-table">
        <thead>
          <tr>
            <th>deviation</th>
            <th>rule</th>
            <th>text</th>
            <th>status</th>
            <th>programmable</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item, index) => (
            <tr key={item.deviation_id ?? index}>
              <td className="rendered-table-mono">{item.deviation_id ?? ""}</td>
              <td className="rendered-table-mono">{item.rule_id ?? ""}</td>
              <td>{item.deviation_text ?? item.text ?? ""}</td>
              <td>{item.status ?? ""}</td>
              <td>{item.programmable === null || item.programmable === undefined ? "—" : item.programmable ? "yes" : "no"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** #/review-and-finalize — Step 7 review panel inside the step-page template. */
export function ReviewStepPage(props: ReviewStepPageProps): JSX.Element {
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
    tabParam,
    onStepStatusesChange,
    onAcceptAndContinue,
    isAcceptingCoding,
    codingAcceptError
  } = props;
  const trimmed = studyId.trim();
  const [rows, setRows] = useState<Step7DeviationRow[]>([]);

  const handleRowsChange = useCallback((nextRows: Step7DeviationRow[]) => {
    setRows(nextRows);
  }, []);

  const completion = useMemo(() => {
    const counts = { accepted: 0, rejected: 0, to_review: 0, pending: 0 };
    for (const row of rows) {
      counts[row.status] += 1;
    }
    return counts;
  }, [rows]);
  const total = rows.length;

  const completionBar =
    total > 0 ? (
      <div className="completion-bar" aria-label="Review completion">
        {(["accepted", "rejected", "to_review", "pending"] as const).map((key) =>
          completion[key] > 0 ? (
            <div
              key={key}
              className={`completion-bar-segment completion-bar-${key}`}
              style={{ width: `${(completion[key] / total) * 100}%` }}
              title={`${key.replace("_", " ")}: ${completion[key]}`}
            >
              {completion[key]}
            </div>
          ) : null
        )}
      </div>
    ) : undefined;

  const tabs = useMemo<StepTabDef[]>(() => {
    if (!trimmed) {
      return [];
    }
    return [
      {
        id: "review-state",
        label: "Review state JSON",
        isArtifact: true,
        render: () => <JsonViewer studyId={trimmed} artifact="deviations-review-state" />
      },
      {
        id: "pseudo-logic",
        label: "Pseudo logic",
        isArtifact: true,
        render: () => (
          <JsonViewer
            studyId={trimmed}
            artifact="pseudo-logic-validated"
            renderRendered={(data) => PseudoLogicRendered(data)}
            renderedLabel="Cards"
            emptyMessage="Pseudo logic not generated yet — run finalize."
          />
        )
      },
      {
        id: "final-json",
        label: "final_deviations.json",
        isArtifact: true,
        render: () => (
          <JsonViewer
            studyId={trimmed}
            artifact="final-deviations"
            renderRendered={(data) => FinalDeviationsTable(data)}
            renderedLabel="Table"
            emptyMessage="Final output not generated yet — run finalize."
          />
        )
      }
    ];
  }, [trimmed]);

  return (
    <StepPage
      title="Review & Finalize"
      description="Review every deviation decision, refine with the model, then finalize pseudo logic and outputs."
      status={stepNavStatus(stepInfo, isStepRunning, Boolean(runError))}
      statusDetail={countDetail(stepInfo)}
      onRun={onRun}
      isRunning={isStepRunning}
      dependencies={dependencyInfos(stepInfo, backendStatuses)}
      hasOutput
      banner={
        <>
          {runError ? <p className="step1-error">{runError}</p> : null}
          {completionBar}
        </>
      }
      controls={
        <Step7ReviewPanel
          studyId={studyId}
          onStepStatusesChange={onStepStatusesChange}
          onAcceptAndContinue={onAcceptAndContinue}
          isAcceptingCoding={isAcceptingCoding}
          codingAcceptError={codingAcceptError}
          onRowsChange={handleRowsChange}
        />
      }
      runningInfo={<p className="step1-status">Generating pseudo logic and finalizing outputs…</p>}
      tabs={tabs}
      initialTabId={tabParam}
      onPrev={goPrev}
      onNext={goNext}
      prevLabel={prevLabel}
      nextLabel={nextLabel}
    />
  );
}
