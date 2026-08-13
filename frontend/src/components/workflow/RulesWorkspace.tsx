import { useState } from "react";
import type { StepStatus } from "../../services/stepApi";
import type { RulePreviewRow } from "../../utils/previewFormat";
import { ParagraphViewer } from "../viewers/ParagraphViewer";
import { RulesList } from "./RulesList";
import { RulesListChat } from "./RulesListChat";

type RightPane = "chat" | "protocol";

interface RulesWorkspaceProps {
  studyId: string;
  activeVersion: string | null;
  chatDeployment: string;
  rules: RulePreviewRow[];
  chatKey: number;
  onApplied: (statuses: Record<string, StepStatus>) => void;
}

export function RulesWorkspace({
  studyId,
  activeVersion,
  chatDeployment,
  rules,
  chatKey,
  onApplied
}: RulesWorkspaceProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [rightPane, setRightPane] = useState<RightPane>("chat");
  const [focusRef, setFocusRef] = useState<string | undefined>(undefined);
  const [highlightRefs, setHighlightRefs] = useState<string[]>([]);

  function handleSelect(ruleId: string): void {
    setSelectedId(ruleId ? ruleId : null);
  }

  function handleOpenParagraphRef(refId: string, allRefs: string[]): void {
    setFocusRef(refId);
    setHighlightRefs(allRefs);
    setRightPane("protocol");
  }

  return (
    <div className="step7-layout step7-layout-kit">
      <div className="step7-list-pane">
        <RulesList
          rules={rules}
          selectedId={selectedId}
          studyId={studyId}
          onSelect={handleSelect}
          onOpenParagraphRef={handleOpenParagraphRef}
        />
      </div>
      <div className="step7-reading-pane">
        {rules.length > 0 ? (
          <>
            <div className="rules-reading-tabs" role="tablist" aria-label="Rules sidebar">
              <button
                type="button"
                role="tab"
                className={`rules-reading-tab ${rightPane === "chat" ? "is-active" : ""}`}
                aria-selected={rightPane === "chat"}
                onClick={() => setRightPane("chat")}
              >
                Chat
              </button>
              <button
                type="button"
                role="tab"
                className={`rules-reading-tab ${rightPane === "protocol" ? "is-active" : ""}`}
                aria-selected={rightPane === "protocol"}
                onClick={() => setRightPane("protocol")}
              >
                Protocol
              </button>
            </div>
            <div className="rules-reading-body">
              {rightPane === "chat" ? (
                <RulesListChat
                  key={`${chatKey}:${activeVersion ?? ""}`}
                  studyId={studyId}
                  activeVersion={activeVersion}
                  chatDeployment={chatDeployment}
                  onApplied={onApplied}
                />
              ) : (
                <ParagraphViewer
                  studyId={studyId}
                  focusRef={focusRef}
                  highlightRefs={highlightRefs}
                  height="100%"
                />
              )}
            </div>
          </>
        ) : (
          <div className="step7-reading-empty" aria-live="polite">
            <p className="step7-reading-empty-title">No rules yet</p>
            <p className="step7-muted">Run Rules extraction to discuss the rule list with the assistant.</p>
          </div>
        )}
      </div>
    </div>
  );
}
