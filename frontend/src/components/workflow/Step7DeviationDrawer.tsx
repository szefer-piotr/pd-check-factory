import { useEffect, useRef, useState } from "react";
import {
  fetchStep7DeviationChat,
  generateStep7PseudoLogic,
  refineStep7Deviation,
  type Step7ChatMessage,
  type Step7DeviationRow,
  type Step7ReviewSource,
  type StepStatus
} from "../../services/stepApi";
import { ChatSendIcon } from "./ChatSendIcon";

interface Step7DeviationDrawerProps {
  studyId: string;
  reviewSource: Step7ReviewSource;
  row: Step7DeviationRow | null;
  alsoPseudo: boolean;
  chatDeployment: string;
  chatRefreshKey?: number;
  onRowUpdated: (row: Step7DeviationRow) => void;
  onStepStatusesChange: (statuses: Record<string, StepStatus>) => void;
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
  reviewSource,
  row,
  alsoPseudo,
  chatDeployment,
  chatRefreshKey = 0,
  onRowUpdated,
  onStepStatusesChange
}: Step7DeviationDrawerProps): JSX.Element | null {
  const [messages, setMessages] = useState<Step7ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [lastMissingCaveats, setLastMissingCaveats] = useState<string[]>([]);
  const [listRevision, setListRevision] = useState<number | undefined>(undefined);
  const threadRef = useRef<HTMLDivElement>(null);

  const deviationId = row?.deviation_id ?? "";

  useEffect(() => {
    if (!deviationId) {
      return;
    }
    setError("");
    setChatInput("");
    setLastMissingCaveats([]);
    async function loadChat(): Promise<void> {
      try {
        const chat = await fetchStep7DeviationChat(studyId.trim(), deviationId);
        setMessages(chat.messages);
        if (typeof chat.listRevision === "number") {
          setListRevision(chat.listRevision);
        }
      } catch {
        setMessages([]);
      }
    }
    void loadChat();
  }, [deviationId, studyId, chatRefreshKey]);

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
        alsoPseudo,
        reviewSource,
        chatDeployment,
        listRevision
      );
      let currentRow = result.row;
      setMessages(result.messages);
      setLastMissingCaveats(result.missingCaveats ?? []);
      if (typeof result.listRevision === "number") {
        setListRevision(result.listRevision);
      }
      setChatInput("");
      onRowUpdated(currentRow);
      onStepStatusesChange(result.stepStatuses);

      if (alsoPseudo && currentRow.status === "accepted" && !currentRow.pseudo_logic) {
        const pseudo = await generateStep7PseudoLogic(studyId.trim(), activeRow.deviation_id, reviewSource);
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

  return (
    <aside className="step7-drawer step7-drawer-chat-only" aria-label={`Chat for ${row.deviation_id}`}>
      {error ? <p className="step1-error step7-drawer-error">{error}</p> : null}

      <section className="step7-drawer-chat-block step7-chatgpt-shell" aria-label="Refinement chat">
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
              <p className="step7-chatgpt-empty-hint">
                Ask questions, rewrite text/notes, update status or category, or merge named
                deviations. Split and bulk filter edits are not available here.
              </p>
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
                {isSending ? <span className="step7-chatgpt-send-spinner" aria-hidden /> : <ChatSendIcon />}
              </button>
            </div>
            <p className="step7-chatgpt-composer-hint">Enter to send · Shift+Enter new line</p>
          </div>
        </footer>
      </section>
    </aside>
  );
}
