import { useEffect, useRef, useState } from "react";
import { LlmDeploymentSelect } from "../ui/LlmDeploymentSelect";
import {
  fetchRulesChat,
  refineRulesChat,
  type OpenAiDeploymentOption,
  type Step7ChatMessage,
  type StepStatus
} from "../../services/stepApi";

interface RulesListChatProps {
  studyId: string;
  llmDeployments: OpenAiDeploymentOption[];
  deploymentsLoading: boolean;
  chatDeployment: string;
  onChatDeploymentChange: (value: string) => void;
  onApplied: (statuses: Record<string, StepStatus>) => void;
}

export function RulesListChat({
  studyId,
  llmDeployments,
  deploymentsLoading,
  chatDeployment,
  onChatDeploymentChange,
  onApplied
}: RulesListChatProps): JSX.Element {
  const [messages, setMessages] = useState<Step7ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState("");
  const [ruleCount, setRuleCount] = useState(0);
  const [version, setVersion] = useState<string | null>(null);
  const threadRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!studyId.trim()) {
      return;
    }
    let cancelled = false;
    void fetchRulesChat(studyId.trim())
      .then((result) => {
        if (!cancelled) {
          setMessages(result.messages);
          setRuleCount(result.ruleCount);
          setVersion(result.activeVersion ?? null);
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
  }, [studyId]);

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
        llmDeployment: chatDeployment || undefined
      });
      setMessages(result.messages);
      setRuleCount(result.ruleCount);
      if (result.version) {
        setVersion(result.version);
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
    <section className="rules-list-chat step7-chatgpt-shell" aria-label="Rules list chat">
      <header className="step7-chatgpt-head">
        <div className="step7-chatgpt-head-text">
          <h5 className="step7-chatgpt-title">Rules discussion</h5>
          <p className="step7-chatgpt-sub">
            Chat about the whole rule list. Applied edits create a new Rules artifact version.
            {ruleCount ? ` · ${ruleCount} rules` : ""}
            {version ? ` · ${version}` : ""}
          </p>
        </div>
      </header>

      {error ? <p className="pipeline-error">{error}</p> : null}

      <div className="step7-chatgpt-thread" ref={threadRef}>
        {messages.length === 0 ? (
          <div className="step7-chatgpt-empty">
            <p className="step7-chatgpt-empty-title">No messages yet</p>
            <p className="step7-chatgpt-empty-hint">
              Ask to merge duplicates, rewrite titles, or add a missing rule.
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
              </div>
            );
          })
        )}
      </div>

      <footer className="step7-chatgpt-footer">
        <LlmDeploymentSelect
          id="rules-chat-llm-deployment"
          label="Chat model"
          value={chatDeployment}
          deployments={llmDeployments}
          isLoading={deploymentsLoading}
          onChange={onChatDeploymentChange}
        />
        <div className="step7-chatgpt-composer-area">
          <div className="step7-chatgpt-composer">
            <textarea
              className="step7-chatgpt-input"
              rows={3}
              value={input}
              disabled={isSending}
              placeholder="Describe changes to the rule list…"
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
          <p className="step7-chatgpt-composer-hint">Enter to send · Shift+Enter new line · applies as a new version</p>
        </div>
      </footer>
    </section>
  );
}
