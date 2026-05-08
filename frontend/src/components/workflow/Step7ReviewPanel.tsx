import { Fragment, useEffect, useState } from "react";
import {
  fetchStep7DeviationChat,
  fetchStep7Deviations,
  refineStep7Deviation,
  updateStep7DeviationStatus,
  type Step7ChatMessage,
  type Step7DeviationRow,
  type StepStatus
} from "../../services/stepApi";

interface Step7ReviewPanelProps {
  studyId: string;
  onStepStatusesChange: (statuses: Record<string, StepStatus>) => void;
}

const XLSX_COLUMNS = [
  { key: "rule_id", label: "rule_id" },
  { key: "deviation_id", label: "deviation_id" },
  { key: "rule_title", label: "rule_title" },
  { key: "deviation_text", label: "deviation_text" },
  { key: "paragraph_refs_text", label: "paragraph_refs" },
  { key: "pseudo_logic", label: "pseudo_logic" }
] as const;

export function Step7ReviewPanel({ studyId, onStepStatusesChange }: Step7ReviewPanelProps): JSX.Element {
  const [rows, setRows] = useState<Step7DeviationRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [chatByDeviation, setChatByDeviation] = useState<Record<string, Step7ChatMessage[]>>({});
  const [chatInputByDeviation, setChatInputByDeviation] = useState<Record<string, string>>({});
  const [pendingRefineId, setPendingRefineId] = useState<string | null>(null);

  useEffect(() => {
    async function loadRows(): Promise<void> {
      if (!studyId.trim()) {
        setRows([]);
        return;
      }
      setIsLoading(true);
      setError("");
      try {
        const response = await fetchStep7Deviations(studyId.trim());
        setRows(response.rows);
        onStepStatusesChange(response.stepStatuses);
      } catch (loadError) {
        setRows([]);
        setError(loadError instanceof Error ? loadError.message : "Unable to load Step 7 deviations.");
      } finally {
        setIsLoading(false);
      }
    }
    void loadRows();
  }, [studyId, onStepStatusesChange]);

  async function toggleExpanded(deviationId: string): Promise<void> {
    if (expandedId === deviationId) {
      setExpandedId(null);
      return;
    }
    setExpandedId(deviationId);
    if (chatByDeviation[deviationId]) {
      return;
    }
    try {
      const chat = await fetchStep7DeviationChat(studyId.trim(), deviationId);
      setChatByDeviation((previous) => ({ ...previous, [deviationId]: chat.messages }));
    } catch {
      setChatByDeviation((previous) => ({ ...previous, [deviationId]: [] }));
    }
  }

  async function handleRefine(deviationId: string): Promise<void> {
    const message = chatInputByDeviation[deviationId] ?? "";
    setPendingRefineId(deviationId);
    setError("");
    try {
      const result = await refineStep7Deviation(studyId.trim(), deviationId, message, true);
      setRows((previous) => previous.map((row) => (row.deviation_id === deviationId ? result.row : row)));
      setChatByDeviation((previous) => ({ ...previous, [deviationId]: result.messages }));
      setChatInputByDeviation((previous) => ({ ...previous, [deviationId]: "" }));
      onStepStatusesChange(result.stepStatuses);
    } catch (refineError) {
      setError(refineError instanceof Error ? refineError.message : "Unable to refine this deviation.");
    } finally {
      setPendingRefineId(null);
    }
  }

  async function handleStatusUpdate(deviationId: string, status: Step7DeviationRow["status"]): Promise<void> {
    setError("");
    try {
      const updated = await updateStep7DeviationStatus(studyId.trim(), deviationId, status);
      setRows((previous) => previous.map((row) => (row.deviation_id === deviationId ? updated.row : row)));
      onStepStatusesChange(updated.stepStatuses);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update status.");
    }
  }

  return (
    <section className="step7-panel" aria-label="Step 7 review table">
      <h3>Step 7 Deviation Review Grid</h3>
      <p className="step1-subtitle">Excel-like table aligned to final workbook columns with per-row chat refinement.</p>
      {error ? <p className="step1-error">{error}</p> : null}
      {isLoading ? <p className="step7-muted">Loading deviations...</p> : null}
      {!isLoading && rows.length === 0 ? <p className="step7-muted">No deviations available for review.</p> : null}

      {rows.length > 0 ? (
        <div className="step7-grid-wrap">
          <table className="step7-grid" aria-label="Step 7 deviations spreadsheet">
            <thead>
              <tr>
                <th aria-label="expand" />
                {XLSX_COLUMNS.map((col) => (
                  <th key={col.key}>{col.label}</th>
                ))}
                <th>status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <Fragment key={row.deviation_id}>
                  <tr>
                    <td>
                      <button
                        className="button button-link"
                        type="button"
                        onClick={() => void toggleExpanded(row.deviation_id)}
                        aria-expanded={expandedId === row.deviation_id}
                      >
                        {expandedId === row.deviation_id ? "Hide" : "Open"}
                      </button>
                    </td>
                    <td>{row.rule_id}</td>
                    <td>{row.deviation_id}</td>
                    <td>{row.rule_title}</td>
                    <td>{row.deviation_text}</td>
                    <td>{row.paragraph_refs_text}</td>
                    <td>{row.pseudo_logic}</td>
                    <td>
                      <span className={`step7-status step7-status-${row.status}`}>{row.status}</span>
                    </td>
                  </tr>
                  {expandedId === row.deviation_id ? (
                    <tr className="step7-expanded-row">
                      <td colSpan={8}>
                        <div className="step7-chat" aria-live="polite">
                          <h4>Refinement Loop: {row.deviation_id}</h4>
                          <p className="step7-muted">{row.deviation_text}</p>
                          <div className="step7-chat-log">
                            {(chatByDeviation[row.deviation_id] ?? []).map((message, index) => (
                              <div className="step7-chat-msg" key={`${message.ts}-${index}`}>
                                <strong>{message.role}:</strong> {message.text}
                              </div>
                            ))}
                          </div>
                          <textarea
                            className="step7-chat-input"
                            value={chatInputByDeviation[row.deviation_id] ?? ""}
                            onChange={(event) =>
                              setChatInputByDeviation((previous) => ({ ...previous, [row.deviation_id]: event.target.value }))
                            }
                            placeholder="Add DM instruction for this deviation..."
                          />
                          <div className="step7-chat-actions">
                            <button
                              className="button"
                              type="button"
                              onClick={() => void handleRefine(row.deviation_id)}
                              disabled={pendingRefineId === row.deviation_id}
                            >
                              {pendingRefineId === row.deviation_id ? "Refining..." : "Send (refine)"}
                            </button>
                            <button
                              className="button button-secondary"
                              type="button"
                              onClick={() => void handleStatusUpdate(row.deviation_id, "accepted")}
                            >
                              Accept
                            </button>
                            <button
                              className="button button-secondary"
                              type="button"
                              onClick={() => void handleStatusUpdate(row.deviation_id, "to_review")}
                            >
                              To Review
                            </button>
                            <button
                              className="button button-secondary"
                              type="button"
                              onClick={() => void handleStatusUpdate(row.deviation_id, "rejected")}
                            >
                              Reject
                            </button>
                          </div>
                        </div>
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}
