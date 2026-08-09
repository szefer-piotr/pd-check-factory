import { useState } from "react";
import type { StepStatus } from "../../services/stepApi";
import type { RulePreviewRow } from "../../utils/previewFormat";
import { RulesList } from "./RulesList";
import { RulesListChat } from "./RulesListChat";

interface RulesWorkspaceProps {
  studyId: string;
  chatDeployment: string;
  rules: RulePreviewRow[];
  chatKey: number;
  onApplied: (statuses: Record<string, StepStatus>) => void;
}

export function RulesWorkspace({
  studyId,
  chatDeployment,
  rules,
  chatKey,
  onApplied
}: RulesWorkspaceProps): JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  function handleSelect(ruleId: string): void {
    setSelectedId(ruleId ? ruleId : null);
  }

  return (
    <div className="step7-layout step7-layout-kit">
      <div className="step7-list-pane">
        <RulesList rules={rules} selectedId={selectedId} onSelect={handleSelect} />
      </div>
      <div className="step7-reading-pane">
        {rules.length > 0 ? (
          <RulesListChat
            key={chatKey}
            studyId={studyId}
            chatDeployment={chatDeployment}
            onApplied={onApplied}
          />
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
