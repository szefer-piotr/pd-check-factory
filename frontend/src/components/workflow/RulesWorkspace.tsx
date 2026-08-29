import { useState } from "react";
import { usePipelineJobs } from "../../jobs/PipelineJobContext";
import type { StepStatus } from "../../services/stepApi";
import type { RulePreviewRow } from "../../utils/previewFormat";
import { WorkspaceInspector } from "../pipeline/WorkspaceInspector";
import { RulesList } from "./RulesList";
import { RulesListChat } from "./RulesListChat";

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
  const { setProtocolFocus, openInspector, activityOpen } = usePipelineJobs();
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function handleSelect(ruleId: string): void {
    setSelectedId(ruleId ? ruleId : null);
  }

  function handleOpenParagraphRef(refId: string, allRefs: string[]): void {
    setProtocolFocus({ focusRef: refId, highlightRefs: allRefs });
    openInspector("protocol");
  }

  return (
    <div className={`step7-layout step7-layout-kit ${activityOpen ? "inspector-open" : ""}`}>
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
          <div className="rules-reading-body rules-reading-body-chat-only">
            <RulesListChat
              key={`${chatKey}:${activeVersion ?? ""}`}
              studyId={studyId}
              activeVersion={activeVersion}
              chatDeployment={chatDeployment}
              onApplied={onApplied}
            />
          </div>
        ) : (
          <div className="step7-reading-empty" aria-live="polite">
            <p className="step7-reading-empty-title">No rules yet</p>
            <p className="step7-muted">Run Rules extraction to discuss the rule list with the assistant.</p>
          </div>
        )}
      </div>
      <WorkspaceInspector />
    </div>
  );
}
