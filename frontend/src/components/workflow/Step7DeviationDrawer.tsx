import { useEffect, useRef, useState } from "react";
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

function formatChatTime(ts: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { timeStyle: "short", dateStyle: "short" }).format(new Date(ts));
  } catch {
    return "";
  }
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
  const [lastMissingCaveats, setLastMissingCaveats] = useState<string[]>([]);

  const threadRef = useRef<HTMLDivElement>(null);

  const deviationId = row?.deviation_id ?? "";

  useEffect(() => {
    if (!deviationId) {
      return;
    }
    setError("");
    setIsEditing(false);
    setEditForm(null);
    setChatInput("");
    setLastMissingCaveats([]);
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

  useEffect(() => {
    const el = threadRef.current;
    if (!el) {
      return;
    }
    el.scrollTop = el.scrollHeight;
  }, [messages, isSending]);

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
      const result = await refineStep7Deviation(
        studyId.trim(),
        activeRow.deviation_id,
        message,
        true,
        alsoPseudo
      );
      let currentRow = result.row;
      setMessages(result.messages);
      setLastMissingCaveats(result.missingCaveats ?? []);
      setChatInput("");
      onRowUpdated(currentRow);
      onStepStatusesChange(result.stepStatuses);

      if (alsoPseudo && currentRow.status === "accepted" && !currentRow.pseudo_logic) {
        const pseudo = await generateStep7PseudoLogic(studyId.trim(), activeRow.deviation_id);
        currentRow = pseudo.row;
        onRowUpdated(currentRow);
        onStepStatusesChange(pseudo.stepStatuses);
        try {
          const refreshed = await fetchStep7DeviationChat(studyId.trim(), activeRow.deviation_id);
          setMessages(refreshed.messages);
        } catch {
          /* keep refine messages */
        }
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
      try {
        const refreshed = await fetchStep7DeviationChat(studyId.trim(), activeRow.deviation_id);
        setMessages(refreshed.messages);
      } catch {
        /* preserve existing transcript */
      }
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
        <div className="step7-drawer-titleblock">
          <h4>{row.deviation_id}</h4>
          <p className="step7-muted">{row.rule_title || row.rule_id}</p>
        </div>
        <div className="step7-drawer-header-actions">
          <button
            className="button button-step7-subtle button-step7-subtle-accent"
            type="button"
            onClick={() => void handleStatusUpdate("accepted")}
          >
            Accept
          </button>
          <button
            className="button button-step7-subtle button-step7-subtle-danger"
            type="button"
            onClick={() => void handleStatusUpdate("rejected")}
          >
            Decline
          </button>
          <button className="button button-ghost" type="button" onClick={onClose} aria-label="Close">
            Close
          </button>
        </div>
      </header>

      {error ? <p className="step1-error step7-drawer-error">{error}</p> : null}

      <div className="step7-drawer-body">
        <section className="step7-drawer-chat-block step7-chatgpt-shell" aria-label="Refinement chat">
          <header className="step7-chatgpt-head">
            <div className="step7-chatgpt-head-text">
              <h5 className="step7-chatgpt-title">Messages</h5>
              {messages.length === 0 ? (
                <p className="step7-chatgpt-sub">Thread preview — new instructions will show up here.</p>
              ) : (
                <p
                  className="step7-chatgpt-sub step7-chatgpt-preview-line"
                  title={messages[messages.length - 1].text}
                >
                  <span className="step7-chatgpt-preview-label">Latest</span>
                  {messages[messages.length - 1].text.replace(/\s+/g, " ").trim()}
                </p>
              )}
            </div>
            <span className="step7-chatgpt-count" aria-label={`${messages.length} messages in thread`}>
              {messages.length}
            </span>
          </header>

          <div
            ref={threadRef}
            className="step7-chatgpt-thread"
            role="log"
            aria-label="Chat transcript"
            aria-live="polite"
          >
            {messages.length === 0 ? (
              <div className="step7-chatgpt-empty">
                <p className="step7-chatgpt-empty-title">No messages yet</p>
                <p className="step7-chatgpt-empty-hint">Describe the change you want for this deviation.</p>
              </div>
            ) : (
              messages.map((message, index) => {
                const isUser = message.role === "dm";
                const isLastAssistant =
                  !isUser && index === messages.length - 1 && message.role === "assistant";
                return (
                  <div
                    key={`${message.ts}-${index}`}
                    className={`step7-chatgpt-turn step7-chatgpt-turn-${isUser ? "user" : "assistant"}`}
                  >
                    <span className="step7-chatgpt-role">{isUser ? "You" : "Assistant"}</span>
                    <div
                      className={`step7-chatgpt-bubble step7-chatgpt-bubble-${isUser ? "user" : "assistant"}`}
                    >
                      <p className="step7-chatgpt-bubble-text">{message.text}</p>
                    </div>
                    {isLastAssistant && lastMissingCaveats.length > 0 ? (
                      <p className="step7-chatgpt-composer-hint" role="note">
                        Evidence caveats: {lastMissingCaveats.slice(0, 3).join("; ")}
                      </p>
                    ) : null}
                    {message.ts ? (
                      <time className="step7-chatgpt-time" dateTime={message.ts}>
                        {formatChatTime(message.ts)}
                      </time>
                    ) : null}
                  </div>
                );
              })
            )}
          </div>

          <footer className="step7-chatgpt-footer">
            <label className="step7-chatgpt-option">
              <input type="checkbox" checked={alsoPseudo} onChange={(event) => setAlsoPseudo(event.target.checked)} />
              <span>Generate pseudo logic after refine (when accepted)</span>
            </label>
            <div className="step7-chatgpt-composer-area">
              <div className="step7-chatgpt-composer">
                <textarea
                  className="step7-chatgpt-input"
                  rows={2}
                  value={chatInput}
                  disabled={isSending}
                  placeholder="Message the model..."
                  onChange={(event) => setChatInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== "Enter") {
                      return;
                    }
                    if (event.shiftKey) {
                      return;
                    }
                    event.preventDefault();
                    if (!chatInput.trim() || isSending) {
                      return;
                    }
                    void handleSend();
                  }}
                />
                <button
                  className="step7-chatgpt-send"
                  type="button"
                  disabled={isSending || !chatInput.trim()}
                  onClick={() => void handleSend()}
                  aria-busy={isSending}
                  title="Send"
                >
                  <span className="visually-hidden">{isSending ? "Sending" : "Send"}</span>
                  {isSending ? (
                    <span className="step7-chatgpt-send-spinner" aria-hidden />
                  ) : (
                    <svg
                      className="step7-chatgpt-send-icon"
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      aria-hidden
                    >
                      <path
                        d="m5 12 7-9 11 14-11 3L5 12Z"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinejoin="round"
                        fill="rgba(255,255,255,0.08)"
                      />
                    </svg>
                  )}
                </button>
              </div>
              <p className="step7-chatgpt-composer-hint">Enter to send · Shift+Enter new line</p>
            </div>
          </footer>
        </section>

        <div className="step7-drawer-upper-scroll">
          <details className="step7-drawer-collapsible">
            <summary>Supporting evidence</summary>
            <div className="step7-drawer-collapsible-inner">
              <div className="step7-evidence-panel">
                <h6>Rule</h6>
                <p className="step7-evidence-body">{row.rule_text || "No rule text."}</p>
                <h6>Supporting sentences</h6>
                {(row.supporting_sentences ?? []).length > 0 ? (
                  (row.supporting_sentences ?? []).map((sentence) => (
                    <p key={sentence.ref} className="step7-evidence-body">
                      <strong>{sentence.ref}:</strong> {sentence.text || "—"}
                    </p>
                  ))
                ) : (
                  <p className="step7-evidence-body">None</p>
                )}
                <h6>Data support note</h6>
                <p className="step7-evidence-body">{row.data_support_note || "None"}</p>
              </div>
            </div>
          </details>

          <details className="step7-drawer-collapsible" open>
            <summary>Deviation text</summary>
            <div className="step7-drawer-collapsible-inner">
              {isEditing && editForm ? (
                <div className="step7-form-grid">
                  <textarea
                    className="step7-chat-input"
                    value={editForm.text}
                    onChange={(event) =>
                      setEditForm((previous) => (previous ? { ...previous, text: event.target.value } : previous))
                    }
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
                      setEditForm((previous) =>
                        previous ? { ...previous, data_support_note: event.target.value } : previous
                      )
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
                  <div className="step7-drawer-deviation-body">
                    <p className="step7-drawer-text step7-drawer-text-full">{row.deviation_text}</p>
                  </div>
                  <button className="button button-ghost" type="button" onClick={startEdit}>
                    Edit deviation
                  </button>
                </>
              )}
            </div>
          </details>

          <details className="step7-drawer-collapsible">
            <summary>Pseudo logic</summary>
            <div className="step7-drawer-collapsible-inner">
              <div className="step7-pseudo-panel">
                {row.pseudo_logic ? (
                  <pre className="step7-drawer-code">{row.pseudo_logic}</pre>
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
              </div>
            </div>
          </details>
        </div>

      </div>
    </aside>
  );
}
