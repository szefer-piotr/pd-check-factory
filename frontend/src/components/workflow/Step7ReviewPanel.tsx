import { useEffect, useMemo, useState } from "react";
import {
  createStep7Deviation,
  createStep7Rule,
  deleteStep7Deviation,
  deleteStep7Rule,
  acceptStep7DeviationsAll,
  fetchStep7Deviations,
  generateStep7PseudoLogicAll,
  exportStep7DeviationsWorkbook,
  importStep7DeviationsWorkbook,
  type Step7DeviationPayload,
  type Step7DeviationRow,
  type Step7RulePayload,
  type StepStatus
} from "../../services/stepApi";
import { Step7DeviationDrawer } from "./Step7DeviationDrawer";
import { Step7RuleGroups, groupDeviationsByRule } from "./Step7RuleGroups";

interface Step7ReviewPanelProps {
  studyId: string;
  onStepStatusesChange: (statuses: Record<string, StepStatus>) => void;
}

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
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isBulkAccepting, setIsBulkAccepting] = useState(false);
  const [isBulkGenerating, setIsBulkGenerating] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [acceptStatus, setAcceptStatus] = useState("");
  const [bulkStatus, setBulkStatus] = useState("");
  const [exportStatus, setExportStatus] = useState("");
  const [mutationStatus, setMutationStatus] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [deviationForm, setDeviationForm] = useState<Step7DeviationPayload>(EMPTY_DEVIATION_FORM);
  const [ruleForm, setRuleForm] = useState<Step7RulePayload>(EMPTY_RULE_FORM);
  const [workbookFile, setWorkbookFile] = useState<File | null>(null);

  const selectedRow = useMemo(
    () => rows.find((row) => row.deviation_id === selectedId) ?? null,
    [rows, selectedId]
  );

  const groups = useMemo(() => groupDeviationsByRule(rows), [rows]);

  const statusCounts = useMemo(() => {
    const counts = { pending: 0, to_review: 0, accepted: 0, rejected: 0 };
    for (const row of rows) {
      counts[row.status] += 1;
    }
    return counts;
  }, [rows]);

  const acceptedCount = statusCounts.accepted;
  const acceptAllCount = statusCounts.pending + statusCounts.to_review;

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
        setError(loadError instanceof Error ? loadError.message : "Unable to load deviations.");
      } finally {
        setIsLoading(false);
      }
    }
    void loadRows();
  }, [studyId, onStepStatusesChange]);

  function handleRowUpdated(row: Step7DeviationRow): void {
    setRows((previous) => previous.map((item) => (item.deviation_id === row.deviation_id ? row : item)));
  }

  async function handleExportWorkbook(): Promise<void> {
    if (!studyId.trim()) {
      return;
    }
    setIsExporting(true);
    setError("");
    setExportStatus("");
    try {
      const result = await exportStep7DeviationsWorkbook(studyId.trim());
      const url = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = result.fileName;
      anchor.click();
      URL.revokeObjectURL(url);
      setExportStatus(`Downloaded ${result.fileName}.`);
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : "Unable to generate Excel.");
    } finally {
      setIsExporting(false);
    }
  }

  async function handleAcceptAll(): Promise<void> {
    setIsBulkAccepting(true);
    setError("");
    setAcceptStatus("");
    try {
      const result = await acceptStep7DeviationsAll(studyId.trim());
      setRows(result.rows);
      onStepStatusesChange(result.stepStatuses);
      setAcceptStatus(
        result.accepted === 0
          ? "All deviations are already accepted or rejected."
          : `Accepted ${result.accepted} deviation${result.accepted === 1 ? "" : "s"}.`
      );
    } catch (acceptError) {
      setError(acceptError instanceof Error ? acceptError.message : "Unable to accept deviations.");
    } finally {
      setIsBulkAccepting(false);
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
      setError(generateError instanceof Error ? generateError.message : "Unable to generate pseudo logic.");
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
      setMutationStatus("Added deviation.");
      setMenuOpen(false);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Unable to add deviation.");
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
      setMenuOpen(false);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Unable to add rule.");
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
      setMenuOpen(false);
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Unable to import workbook.");
    }
  }

  async function handleDeleteSelected(): Promise<void> {
    if (!selectedRow) {
      return;
    }
    setError("");
    try {
      const result = await deleteStep7Deviation(studyId.trim(), selectedRow.deviation_id);
      setRows(result.rows);
      onStepStatusesChange(result.stepStatuses);
      setSelectedId(null);
      setMutationStatus("Deleted deviation.");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Unable to delete deviation.");
    }
  }

  async function handleDeleteRule(): Promise<void> {
    if (!selectedRow) {
      return;
    }
    setError("");
    try {
      const result = await deleteStep7Rule(studyId.trim(), selectedRow.rule_id);
      onStepStatusesChange(result.stepStatuses);
      setMutationStatus("Deleted rule.");
    } catch (mutationError) {
      setError(mutationError instanceof Error ? mutationError.message : "Unable to delete rule.");
    }
  }

  return (
    <section className="step7-panel workflow-panel" aria-label="Deviation review">
      <div className="step7-summary-bar">
        <span className="chip">
          Total <strong>{rows.length}</strong>
        </span>
        <span className="chip">
          Accepted <strong>{statusCounts.accepted}</strong>
        </span>
        <span className="chip">
          To review <strong>{statusCounts.to_review}</strong>
        </span>
        <span className="chip">
          Rejected <strong>{statusCounts.rejected}</strong>
        </span>
      </div>

      {error ? <p className="step1-error">{error}</p> : null}
      {mutationStatus ? <p className="step1-status">{mutationStatus}</p> : null}
      {acceptStatus ? <p className="step7-muted">{acceptStatus}</p> : null}
      {bulkStatus ? <p className="step7-muted">{bulkStatus}</p> : null}
      {exportStatus ? <p className="step7-muted">{exportStatus}</p> : null}
      {isLoading ? <p className="step7-muted">Loading deviations...</p> : null}

      <div className="step7-toolbar">
        <button
          className="button button-primary"
          type="button"
          onClick={() => void handleExportWorkbook()}
          disabled={isExporting || isLoading || !studyId.trim()}
        >
          {isExporting ? "Generating Excel..." : "Generate Excel"}
        </button>
        <button
          className="button button-optional"
          type="button"
          onClick={() => void handleAcceptAll()}
          disabled={isBulkAccepting || isLoading || acceptAllCount === 0 || !studyId.trim()}
        >
          {isBulkAccepting ? "Accepting..." : `Accept all (${acceptAllCount})`}
        </button>
        <button
          className="button button-optional"
          type="button"
          onClick={() => void handleGenerateAllPseudoLogic()}
          disabled={isBulkGenerating || isBulkAccepting || acceptedCount === 0}
        >
          {isBulkGenerating ? "Generating..." : `Generate all pseudo (${acceptedCount})`}
        </button>
        <div className="step7-overflow-menu">
          <button className="button button-secondary" type="button" onClick={() => setMenuOpen((open) => !open)}>
            More actions
          </button>
          {menuOpen ? (
            <div className="step7-overflow-panel">
              <div className="step7-form-grid">
                <strong>Add deviation</strong>
                <input className="input" placeholder="deviation_id" value={deviationForm.deviation_id} onChange={(e) => setDeviationForm((p) => ({ ...p, deviation_id: e.target.value }))} />
                <input className="input" placeholder="rule_id" value={deviationForm.rule_id} onChange={(e) => setDeviationForm((p) => ({ ...p, rule_id: e.target.value }))} />
                <input className="input" placeholder="refs (p1, p2)" value={refsToText(deviationForm.paragraph_refs)} onChange={(e) => setDeviationForm((p) => ({ ...p, paragraph_refs: refsFromText(e.target.value) }))} />
                <textarea className="step7-chat-input" placeholder="deviation text" value={deviationForm.text} onChange={(e) => setDeviationForm((p) => ({ ...p, text: e.target.value }))} />
                <button className="button button-optional" type="button" onClick={() => void handleAddDeviation()} disabled={!deviationForm.deviation_id || !deviationForm.rule_id || !deviationForm.text}>
                  Add deviation
                </button>
              </div>
              <div className="step7-form-grid">
                <strong>Add rule</strong>
                <input className="input" placeholder="rule_id" value={ruleForm.rule_id} onChange={(e) => setRuleForm((p) => ({ ...p, rule_id: e.target.value }))} />
                <input className="input" placeholder="title" value={ruleForm.title} onChange={(e) => setRuleForm((p) => ({ ...p, title: e.target.value }))} />
                <textarea className="step7-chat-input" placeholder="rule text" value={ruleForm.text} onChange={(e) => setRuleForm((p) => ({ ...p, text: e.target.value }))} />
                <button className="button button-optional" type="button" onClick={() => void handleAddRule()} disabled={!ruleForm.rule_id}>
                  Add rule
                </button>
              </div>
              <div className="step7-form-grid">
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
              </div>
              {selectedRow ? (
                <div className="step7-chat-actions">
                  <button className="button button-danger" type="button" onClick={() => void handleDeleteSelected()}>
                    Delete selected deviation
                  </button>
                  <button className="button button-danger" type="button" onClick={() => void handleDeleteRule()}>
                    Delete rule {selectedRow.rule_id}
                  </button>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className={`step7-layout ${selectedRow ? "" : "step7-layout-no-drawer"}`}>
        <Step7RuleGroups groups={groups} selectedId={selectedId} onSelect={setSelectedId} />
        {selectedRow ? (
          <Step7DeviationDrawer
            studyId={studyId}
            row={selectedRow}
            onClose={() => setSelectedId(null)}
            onRowUpdated={handleRowUpdated}
            onStepStatusesChange={onStepStatusesChange}
          />
        ) : null}
      </div>
    </section>
  );
}
