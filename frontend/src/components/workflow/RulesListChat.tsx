import { useEffect, useRef, useState } from "react";
import {
  fetchRulesChat,
  refineRulesChat,
  type Step7ChatMessage,
  type StepStatus
} from "../../services/stepApi";
import { ChatSendIcon } from "./ChatSendIcon";

interface RulesListChatProps {
  studyId: string;
  activeVersion: string | null;
  chatDeployment: string;
  onApplied: (statuses: Record<string, StepStatus>) => void;
}

function formatChatTime(ts: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { timeStyle: "short", dateStyle: "short" }).format(new Date(ts));
  } catch {
    return "";
  }
}

export function RulesListChat({
  studyId,
  activeVersion,
  chatDeployment,
  onApplied
}: RulesListChatProps): JSX.Element {
  const [messages, setMessages] = useState<Step7ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [listRevision, setListRevision] = useState<number | undefined>(undefined);
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!studyId.trim()) {
      return;
    }
    let cancelled = false;
    setMessages([]);
    setError("");
    void fetchRulesChat(studyId.trim())
      .then((result) => {
        if (!cancelled) {
          setMessages(result.messages);
          if (typeof result.listRevision === "number") {
            setListRevision(result.listRevision);
          }
        }
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(loadError instanceof Error ? loadError.message : "Unable to load rules chat.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [studyId, activeVersion]);

  useEffect(() => {
    const el = threadRef.current;
    if (el) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, isSending]);

  async function handleSend(): Promise<void> {
    const message = input.trim();
    if (!message || !studyId.trim() || isSending) {
      return;
    }
    setIsSending(true);
    setError("");
    setInput("");
    try {
      const result = await refineRulesChat(studyId.trim(), {
        message,
        apply: true,
        llmDeployment: chatDeployment || undefined,
        expectedRevision: listRevision
      });
      setMessages(result.messages);
      if (typeof result.listRevision === "number") {
        setListRevision(result.listRevision);
      }
      if (result.applied) {
        onApplied(result.stepStatuses);
      }
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : "Unable to process message.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <aside className="step7-drawer step7-drawer-chat-only" aria-label="Rules list chat">
      {error ? <p className="step1-error step7-drawer-error">{error}</p> : null}

      <section className="step7-drawer-chat-block step7-chatgpt-shell" aria-label="Rules discussion">
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
                Ask about rules, edit title/text/paragraph refs, or add/remove a rule by id. Applied
                edits create a new Rules artifact version. Category, programmability, and deviation
                merges belong in a deviation&apos;s chat.
              </p>
            </div>
          ) : (
            messages.map((message, index) => {
              const isUser = message.role === "dm" || message.role === "user";
              return (
                <div
                  key={`${message.ts}-${index}`}
                  className={`step7-chatgpt-turn step7-chatgpt-turn-${isUser ? "user" : "assistant"}`}
                >
                  <span className="step7-chatgpt-role">{isUser ? "You" : "Assistant"}</span>
                  <div className={`step7-chatgpt-bubble step7-chatgpt-bubble-${isUser ? "user" : "assistant"}`}>
                    <p className="step7-chatgpt-bubble-text">{message.text}</p>
                  </div>
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
                value={input}
                disabled={isSending}
                placeholder="Message the model..."
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
              />
              <button
                type="button"
                className="step7-chatgpt-send"
                disabled={isSending || !input.trim()}
                onClick={() => void handleSend()}
                aria-busy={isSending}
                title="Send"
              >
                <span className="visually-hidden">{isSending ? "Sending" : "Send"}</span>
                {isSending ? <span className="step7-chatgpt-send-spinner" aria-hidden /> : <ChatSendIcon />}
              </button>
            </div>
            <p className="step7-chatgpt-composer-hint">Enter to send · Shift+Enter new line · applies as a new version</p>
          </div>
        </footer>
      </section>
    </aside>
  );
}
