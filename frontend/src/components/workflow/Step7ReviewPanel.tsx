import { Fragment, useEffect, useState } from "react";
import {
  createStep7Deviation,
  createStep7Rule,
  deleteStep7Deviation,
  deleteStep7Rule,
  fetchStep7DeviationChat,
  fetchStep7Deviations,
  generateStep7PseudoLogic,
  generateStep7PseudoLogicAll,
  importStep7DeviationsWorkbook,
  refineStep7Deviation,
  updateStep7Deviation,
  updateStep7DeviationStatus,
  updateStep7Rule,
  type Step7ChatMessage,
  type Step7DeviationPayload,
  type Step7DeviationRow,
  type Step7RulePayload,
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

const EMPTY_DEVIATION_FORM: Step7DeviationPayload = {
  deviation_id: "",
  rule_id: "",
  text: "",
  paragraph_refs: [],
  data_support_note: "",
  dm_comment: "",
  status: "pending"
};

const EMPTY_RULE_FORM: Step7RulePayload = {
  rule_id: "",
  title: "",
  text: "",
  paragraph_refs: []
};

function refsFromText(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function refsToText(value: string[]): string {
  return value.join(", ");
}

export function Step7ReviewPanel({ studyId, onStepStatusesChange }: Step7ReviewPanelProps): JSX.Element {
  const [rows, setRows] = useState<Step7DeviationRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [chatByDeviation, setChatByDeviation] = useState<Record<string, Step7ChatMessage[]>>({});
  const [chatInputByDeviation, setChatInputByDeviation] = useState<Record<string, string>>({});
  const [pendingRefineId, setPendingRefineId] = useState<string | null>(null);
  const [pendingPseudoId, setPendingPseudoId] = useState<string | null>(null);
  const [isBulkGenerating, setIsBulkGenerating] = useState(false);
  const [bulkStatus, setBulkStatus] = useState("");
  const [deviationForm, setDeviationForm] = useState<Step7DeviationPayload>(EMPTY_DEVIATION_FORM);
  const [ruleForm, setRuleForm] = useState<Step7RulePayload>(EMPTY_RULE_FORM);
  const [editingDeviationId, setEditingDeviationId] = useState<string | null>(null);
  const [editDeviationForm, setEditDeviationForm] = useState<Step7DeviationPayload>(EMPTY_DEVIATION_FORM);
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [editRuleForm, setEditRuleForm] = useState<Step7RulePayload>(EMPTY_RULE_FORM);
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);
  const [mutationStatus, setMutationStatus] = useState("");

  const acceptedCount = rows.filter((row) => row.status === "accepted").length;

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

  async function handleGeneratePseudoLogic(deviationId: string): Promise<void> {
    setPendingPseudoId(deviationId);
    setError("");
    setBulkStatus("");
    try {
      const result = await generateStep7PseudoLogic(studyId.trim(), deviationId);
      setRows((previous) => previous.map((row) => (row.deviation_id === deviationId ? result.row : row)));
      onStepStatusesChange(result.stepStatuses);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Unable to generate pseudo logic.");
    } finally {
      setPendingPseudoId(null);
    }
  }

  async function handleGenerateAllPseudoLogic(): Promise<void> {
    setIsBulkGenerating(true);
    setError("");
    setBulkStatus("");
    try {
      const result = await generateStep7PseudoLogicAll(studyId.trim());
      setRows(result.rows);
      onStepStatusesChange(result.stepStatuses);
      setBulkStatus(`Generated pseudo logic for ${result.generated} accepted deviation${result.generated === 1 ? "" : "s"}.`);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Unable to generate pseudo logic for all accepted deviations.");
    } finally {
      setIsBulkGenerating(false);
    }
  }

  async function handleAddDeviation(): Promise<void> {
    setError("");
    setMutationStatus("");
    try {
      const result = await createStep7Deviation(studyId.trim(), deviationForm);
      setRows(result.rows);
      onStepStatusesChange(result.stepStatuses);
      setDeviationForm(EMPTY_DEVIATION_FORM);
      setMutationStatus("Added manual deviation.");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Unable to add deviation.");
    }
  }

  async function handleSaveDeviation(deviationId: string): Promise<void> {
    setError("");
    setMutationStatus("");
    try {
      const result = await updateStep7Deviation(studyId.trim(), deviationId, editDeviationForm);
      setRows((previous) => previous.map((row) => (row.deviation_id === deviationId ? result.row : row)));
      onStepStatusesChange(result.stepStatuses);
      setEditingDeviationId(null);
      setMutationStatus("Updated deviation.");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Unable to update deviation.");
    }
  }

  async function handleDeleteDeviation(deviationId: string): Promise<void> {
    setError("");
    setMutationStatus("");
    try {
      const result = await deleteStep7Deviation(studyId.trim(), deviationId);
      setRows(result.rows);
      onStepStatusesChange(result.stepStatuses);
      setMutationStatus("Deleted deviation.");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Unable to delete deviation.");
    }
  }

  async function handleImportWorkbook(): Promise<void> {
    if (!workbookFile) {
      return;
    }
    setError("");
    setMutationStatus("");
    try {
      const result = await importStep7DeviationsWorkbook(studyId.trim(), workbookFile);
      setRows(result.rows);
      onStepStatusesChange(result.stepStatuses);
      setWorkbookFile(null);
      setMutationStatus(`Imported ${result.imported ?? 0} deviation${result.imported === 1 ? "" : "s"}.`);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Unable to import workbook.");
    }
  }

  async function handleAddRule(): Promise<void> {
    setError("");
    setMutationStatus("");
    try {
      const result = await createStep7Rule(studyId.trim(), ruleForm);
      onStepStatusesChange(result.stepStatuses);
      setRuleForm(EMPTY_RULE_FORM);
      setMutationStatus("Added rule.");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Unable to add rule.");
    }
  }

  async function handleSaveRule(ruleId: string): Promise<void> {
    setError("");
    setMutationStatus("");
    try {
      const result = await updateStep7Rule(studyId.trim(), ruleId, editRuleForm);
      onStepStatusesChange(result.stepStatuses);
      setRows((previous) =>
        previous.map((row) =>
          row.rule_id === ruleId
            ? { ...row, rule_title: result.rule?.title ?? row.rule_title, rule_text: result.rule?.text ?? row.rule_text }
            : row
        )
      );
      setEditingRuleId(null);
      setMutationStatus("Updated rule.");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Unable to update rule.");
    }
  }

  async function handleDeleteRule(ruleId: string): Promise<void> {
    setError("");
    setMutationStatus("");
    try {
      const result = await deleteStep7Rule(studyId.trim(), ruleId);
      onStepStatusesChange(result.stepStatuses);
      setMutationStatus("Deleted rule.");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Unable to delete rule.");
    }
  }

  function startEditingDeviation(row: Step7DeviationRow): void {
    setEditingDeviationId(row.deviation_id);
    setEditDeviationForm({
      deviation_id: row.deviation_id,
      rule_id: row.rule_id,
      text: row.deviation_text,
      paragraph_refs: row.paragraph_refs,
      data_support_note: row.data_support_note,
      dm_comment: row.dm_comment,
      status: row.status
    });
  }

  function startEditingRule(row: Step7DeviationRow): void {
    setEditingRuleId(row.rule_id);
    setEditRuleForm({
      rule_id: row.rule_id,
      title: row.rule_title,
      text: row.rule_text,
      paragraph_refs: row.paragraph_refs
    });
  }

  return (
    <section className="step7-panel" aria-label="Step 7 review table">
      <h3>Step 7 Deviation Review Grid</h3>
      <p className="step1-subtitle">Excel-like table aligned to final workbook columns with per-row chat refinement.</p>
      {error ? <p className="step1-error">{error}</p> : null}
      {mutationStatus ? <p className="step1-status">{mutationStatus}</p> : null}
      {isLoading ? <p className="step7-muted">Loading deviations...</p> : null}
      {!isLoading && rows.length === 0 ? <p className="step7-muted">No deviations available for review.</p> : null}

      <div className="step7-toolbar">
        <button
          className="button button-optional"
          type="button"
          onClick={() => void handleGenerateAllPseudoLogic()}
          disabled={isBulkGenerating || acceptedCount === 0}
          title={
            acceptedCount === 0
              ? "Accept at least one deviation before generating pseudo logic."
              : "Generate pseudo logic for every accepted deviation."
          }
        >
          {isBulkGenerating
            ? "Generating pseudo logic..."
            : `Generate pseudo logic for all accepted (${acceptedCount})`}
        </button>
        <label className="button button-optional" htmlFor="step7-import-workbook">
          Choose Excel
        </label>
        <input
          id="step7-import-workbook"
          className="visually-hidden"
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          onChange={(event) => setWorkbookFile(event.target.files?.[0] ?? null)}
        />
        <button className="button button-optional" type="button" onClick={() => void handleImportWorkbook()} disabled={!workbookFile}>
          Import deviations
        </button>
        {bulkStatus ? <span className="step7-muted">{bulkStatus}</span> : null}
      </div>

      <details className="step7-form-panel">
        <summary>Add manual deviation</summary>
        <div className="step7-form-grid">
          <input className="input" placeholder="deviation_id" value={deviationForm.deviation_id} onChange={(event) => setDeviationForm((previous) => ({ ...previous, deviation_id: event.target.value }))} />
          <input className="input" placeholder="rule_id" value={deviationForm.rule_id} onChange={(event) => setDeviationForm((previous) => ({ ...previous, rule_id: event.target.value }))} />
          <input className="input" placeholder="paragraph refs (p1, p2)" value={refsToText(deviationForm.paragraph_refs)} onChange={(event) => setDeviationForm((previous) => ({ ...previous, paragraph_refs: refsFromText(event.target.value) }))} />
          <textarea className="step7-chat-input" placeholder="deviation text" value={deviationForm.text} onChange={(event) => setDeviationForm((previous) => ({ ...previous, text: event.target.value }))} />
          <textarea className="step7-chat-input" placeholder="supporting sentences / data support note" value={deviationForm.data_support_note} onChange={(event) => setDeviationForm((previous) => ({ ...previous, data_support_note: event.target.value }))} />
          <button
            className="button button-optional"
            type="button"
            onClick={() => void handleAddDeviation()}
            disabled={!deviationForm.deviation_id || !deviationForm.rule_id || !deviationForm.text || deviationForm.paragraph_refs.length === 0}
          >
            Add deviation
          </button>
        </div>
      </details>

      <details className="step7-form-panel">
        <summary>Add manual rule</summary>
        <div className="step7-form-grid">
          <input className="input" placeholder="rule_id" value={ruleForm.rule_id} onChange={(event) => setRuleForm((previous) => ({ ...previous, rule_id: event.target.value }))} />
          <input className="input" placeholder="rule title" value={ruleForm.title} onChange={(event) => setRuleForm((previous) => ({ ...previous, title: event.target.value }))} />
          <textarea className="step7-chat-input" placeholder="rule text" value={ruleForm.text} onChange={(event) => setRuleForm((previous) => ({ ...previous, text: event.target.value }))} />
          <button className="button button-optional" type="button" onClick={() => void handleAddRule()} disabled={!ruleForm.rule_id}>
            Add rule
          </button>
        </div>
      </details>

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
                    <td>
                      {row.pseudo_logic ? (
                        row.pseudo_logic
                      ) : (
                        <em className="step7-muted">not generated</em>
                      )}
                    </td>
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
                          <div className="step7-evidence-grid">
                            <article className="step7-evidence-card">
                              <h5>Rule preview</h5>
                              <p><strong>{row.rule_title || row.rule_id}</strong></p>
                              <p>{row.rule_text || "No rule text available."}</p>
                            </article>
                            <article className="step7-evidence-card">
                              <h5>Supporting sentences</h5>
                              {(row.supporting_sentences ?? []).length > 0 ? (
                                (row.supporting_sentences ?? []).map((sentence) => (
                                  <p key={sentence.ref}>
                                    <strong>{sentence.ref}:</strong> {sentence.text || "No paragraph text available."}
                                  </p>
                                ))
                              ) : (
                                <p>No supporting references available.</p>
                              )}
                            </article>
                            <article className="step7-evidence-card">
                              <h5>Data support note</h5>
                              <p>{row.data_support_note || "No data support note available."}</p>
                            </article>
                          </div>
                          {row.programmable !== null ? (
                            <p className="step7-muted">
                              <span
                                className={`step7-pill step7-pill-${row.programmable ? "yes" : "no"}`}
                              >
                                programmable: {row.programmable ? "yes" : "no"}
                              </span>
                              {row.programmability_note ? ` — ${row.programmability_note}` : null}
                            </p>
                          ) : null}
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
                              className="button button-optional"
                              type="button"
                              onClick={() => void handleRefine(row.deviation_id)}
                              disabled={pendingRefineId === row.deviation_id}
                            >
                              {pendingRefineId === row.deviation_id ? "Refining..." : "Send (refine)"}
                            </button>
                            <button
                              className="button button-optional"
                              type="button"
                              onClick={() => void handleGeneratePseudoLogic(row.deviation_id)}
                              disabled={row.status !== "accepted" || pendingPseudoId === row.deviation_id}
                              title={
                                row.status !== "accepted"
                                  ? "Only accepted deviations can have pseudo logic generated."
                                  : "Generate pseudo logic for this deviation."
                              }
                            >
                              {pendingPseudoId === row.deviation_id ? "Generating..." : "Generate pseudo logic"}
                            </button>
                            <button
                              className="button button-primary"
                              type="button"
                              onClick={() => void handleStatusUpdate(row.deviation_id, "accepted")}
                            >
                              Accept
                            </button>
                            <button
                              className="button button-danger"
                              type="button"
                              onClick={() => void handleStatusUpdate(row.deviation_id, "rejected")}
                            >
                              Reject
                            </button>
                            <button
                              className="button button-optional"
                              type="button"
                              onClick={() => startEditingDeviation(row)}
                            >
                              Edit deviation
                            </button>
                            <button
                              className="button button-optional"
                              type="button"
                              onClick={() => startEditingRule(row)}
                            >
                              Edit rule
                            </button>
                            <button
                              className="button button-danger"
                              type="button"
                              onClick={() => void handleDeleteDeviation(row.deviation_id)}
                            >
                              Delete deviation
                            </button>
                            <button
                              className="button button-danger"
                              type="button"
                              onClick={() => void handleDeleteRule(row.rule_id)}
                            >
                              Delete rule
                            </button>
                          </div>
                          {editingDeviationId === row.deviation_id ? (
                            <div className="step7-form-grid step7-inline-editor">
                              <input className="input" value={editDeviationForm.rule_id} onChange={(event) => setEditDeviationForm((previous) => ({ ...previous, rule_id: event.target.value }))} />
                              <input className="input" value={refsToText(editDeviationForm.paragraph_refs)} onChange={(event) => setEditDeviationForm((previous) => ({ ...previous, paragraph_refs: refsFromText(event.target.value) }))} />
                              <textarea className="step7-chat-input" value={editDeviationForm.text} onChange={(event) => setEditDeviationForm((previous) => ({ ...previous, text: event.target.value }))} />
                              <textarea className="step7-chat-input" value={editDeviationForm.data_support_note} onChange={(event) => setEditDeviationForm((previous) => ({ ...previous, data_support_note: event.target.value }))} />
                              <button className="button button-primary" type="button" onClick={() => void handleSaveDeviation(row.deviation_id)}>Save deviation</button>
                              <button className="button button-secondary" type="button" onClick={() => setEditingDeviationId(null)}>Cancel</button>
                            </div>
                          ) : null}
                          {editingRuleId === row.rule_id ? (
                            <div className="step7-form-grid step7-inline-editor">
                              <input className="input" value={editRuleForm.title} onChange={(event) => setEditRuleForm((previous) => ({ ...previous, title: event.target.value }))} />
                              <textarea className="step7-chat-input" value={editRuleForm.text} onChange={(event) => setEditRuleForm((previous) => ({ ...previous, text: event.target.value }))} />
                              <button className="button button-primary" type="button" onClick={() => void handleSaveRule(row.rule_id)}>Save rule</button>
                              <button className="button button-secondary" type="button" onClick={() => setEditingRuleId(null)}>Cancel</button>
                            </div>
                          ) : null}
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
