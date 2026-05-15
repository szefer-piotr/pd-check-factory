import { useEffect, useState } from "react";
import {
  fetchStep7DeviationChat,
  generateStep7PseudoLogic,
  refineStep7Deviation,
  updateStep7Deviation,
  updateStep7DeviationStatus,
  type Step7ChatMessage,
  type Step7DeviationPayload,
  type Step7DeviationRow,
  type StepStatus
} from "../../services/stepApi";

interface Step7DeviationDrawerProps {
  studyId: string;
  row: Step7DeviationRow | null;
  onClose: () => void;
  onRowUpdated: (row: Step7DeviationRow) => void;
  onStepStatusesChange: (statuses: Record<string, StepStatus>) => void;
}

function refsToText(value: string[]): string {
  return value.join(", ");
}

function refsFromText(value: string): string[] {
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function Step7DeviationDrawer({
  studyId,
  row,
  onClose,
  onRowUpdated,
  onStepStatusesChange
}: Step7DeviationDrawerProps): JSX.Element | null {
  const [messages, setMessages] = useState<Step7ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [alsoPseudo, setAlsoPseudo] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState<Step7DeviationPayload | null>(null);
  const [error, setError] = useState("");

  const deviationId = row?.deviation_id ?? "";

  useEffect(() => {
    if (!deviationId) {
      return;
    }
    setError("");
    setIsEditing(false);
    setEditForm(null);
    setChatInput("");
    async function loadChat(): Promise<void> {
      try {
        const chat = await fetchStep7DeviationChat(studyId.trim(), deviationId);
        setMessages(chat.messages);
      } catch {
        setMessages([]);
      }
    }
    void loadChat();
  }, [deviationId, studyId]);

  if (!row) {
    return null;
  }

  const activeRow = row;

  async function handleStatusUpdate(status: Step7DeviationRow["status"]): Promise<void> {
    setError("");
    try {
      const updated = await updateStep7DeviationStatus(studyId.trim(), activeRow.deviation_id, status);
      onRowUpdated(updated.row);
      onStepStatusesChange(updated.stepStatuses);
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Unable to update status.");
    }
  }

  async function handleSend(): Promise<void> {
    const message = chatInput.trim();
    if (!message) {
      return;
    }
    setIsSending(true);
    setError("");
    try {
      const result = await refineStep7Deviation(studyId.trim(), activeRow.deviation_id, message, true);
      let currentRow = result.row;
      setMessages(result.messages);
      setChatInput("");
      onRowUpdated(currentRow);
      onStepStatusesChange(result.stepStatuses);

      if (alsoPseudo && currentRow.status === "accepted") {
        const pseudo = await generateStep7PseudoLogic(studyId.trim(), activeRow.deviation_id);
        currentRow = pseudo.row;
        onRowUpdated(currentRow);
        onStepStatusesChange(pseudo.stepStatuses);
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to process message.");
    } finally {
      setIsSending(false);
    }
  }

  async function handleGeneratePseudo(): Promise<void> {
    setIsSending(true);
    setError("");
    try {
      const result = await generateStep7PseudoLogic(studyId.trim(), activeRow.deviation_id);
      onRowUpdated(result.row);
      onStepStatusesChange(result.stepStatuses);
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : "Unable to generate pseudo logic.");
    } finally {
      setIsSending(false);
    }
  }

  async function handleSaveEdit(): Promise<void> {
    if (!editForm) {
      return;
    }
    setError("");
    try {
      const result = await updateStep7Deviation(studyId.trim(), activeRow.deviation_id, editForm);
      onRowUpdated(result.row);
      onStepStatusesChange(result.stepStatuses);
      setIsEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "Unable to save deviation.");
    }
  }

  function startEdit(): void {
    setIsEditing(true);
    setEditForm({
      deviation_id: activeRow.deviation_id,
      rule_id: activeRow.rule_id,
      text: activeRow.deviation_text,
      paragraph_refs: activeRow.paragraph_refs,
      data_support_note: activeRow.data_support_note,
      dm_comment: activeRow.dm_comment,
      status: activeRow.status
    });
  }

  return (
    <aside className="step7-drawer" aria-label={`Deviation ${row.deviation_id}`}>
      <header className="step7-drawer-header">
        <div>
          <h4>{row.deviation_id}</h4>
          <p className="step7-muted">{row.rule_title || row.rule_id}</p>
        </div>
        <button className="button button-ghost" type="button" onClick={onClose} aria-label="Close">
          Close
        </button>
      </header>

      {error ? <p className="step1-error">{error}</p> : null}

      <section className="step7-drawer-section">
        <h5>Status</h5>
        <div className="step7-chat-actions">
          <button className="button button-primary" type="button" onClick={() => void handleStatusUpdate("accepted")}>
            Accept
          </button>
          <button className="button button-optional" type="button" onClick={() => void handleStatusUpdate("to_review")}>
            To review
          </button>
          <button className="button button-danger" type="button" onClick={() => void handleStatusUpdate("rejected")}>
            Reject
          </button>
        </div>
      </section>

      <section className="step7-drawer-section">
        <h5>Deviation</h5>
        {isEditing && editForm ? (
          <div className="step7-form-grid">
            <textarea
              className="step7-chat-input"
              value={editForm.text}
              onChange={(event) => setEditForm((previous) => (previous ? { ...previous, text: event.target.value } : previous))}
            />
            <input
              className="input"
              value={refsToText(editForm.paragraph_refs)}
              onChange={(event) =>
                setEditForm((previous) =>
                  previous ? { ...previous, paragraph_refs: refsFromText(event.target.value) } : previous
                )
              }
              placeholder="paragraph refs"
            />
            <textarea
              className="step7-chat-input"
              value={editForm.data_support_note}
              onChange={(event) =>
                setEditForm((previous) => (previous ? { ...previous, data_support_note: event.target.value } : previous))
              }
              placeholder="data support note"
            />
            <div className="step7-chat-actions">
              <button className="button button-primary" type="button" onClick={() => void handleSaveEdit()}>
                Save
              </button>
              <button className="button button-ghost" type="button" onClick={() => setIsEditing(false)}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="step7-drawer-text">{row.deviation_text}</p>
            <p className="step7-muted">Refs: {row.paragraph_refs_text || "—"}</p>
            {row.data_support_note ? <p className="step7-muted">Data: {row.data_support_note}</p> : null}
            <button className="button button-ghost" type="button" onClick={startEdit}>
              Edit deviation
            </button>
          </>
        )}
      </section>

      <section className="step7-drawer-section">
        <h5>Pseudo logic</h5>
        {row.pseudo_logic ? (
          <pre className="step7-drawer-text">{row.pseudo_logic}</pre>
        ) : (
          <p className="step7-muted">Not generated yet.</p>
        )}
        {row.programmable !== null ? (
          <p className="step7-muted">
            <span className={`step7-pill step7-pill-${row.programmable ? "yes" : "no"}`}>
              programmable: {row.programmable ? "yes" : "no"}
            </span>
            {row.programmability_note ? ` — ${row.programmability_note}` : null}
          </p>
        ) : null}
        <button
          className="button button-optional"
          type="button"
          onClick={() => void handleGeneratePseudo()}
          disabled={row.status !== "accepted" || isSending}
        >
          Generate pseudo logic
        </button>
      </section>

      <section className="step7-drawer-section">
        <h5>Chat</h5>
        <div className="step7-chat-log">
          {messages.map((message, index) => (
            <div
              key={`${message.ts}-${index}`}
              className={`step7-chat-bubble step7-chat-bubble-${message.role === "dm" ? "dm" : "assistant"}`}
            >
              {message.text}
            </div>
          ))}
        </div>
        <textarea
          className="step7-chat-input"
          value={chatInput}
          onChange={(event) => setChatInput(event.target.value)}
          placeholder="Add DM instruction..."
        />
        <label className="step7-chat-checkbox">
          <input type="checkbox" checked={alsoPseudo} onChange={(event) => setAlsoPseudo(event.target.checked)} />
          Generate pseudo logic after refine (when accepted)
        </label>
        <div className="step7-chat-actions">
          <button className="button button-primary" type="button" onClick={() => void handleSend()} disabled={isSending || !chatInput.trim()}>
            {isSending ? "Sending..." : "Send"}
          </button>
        </div>
      </section>
    </aside>
  );
}
