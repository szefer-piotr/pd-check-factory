import { useEffect, useRef } from "react";
import type { Step7DeviationRow } from "../../services/stepApi";

export interface RuleGroup {
  ruleId: string;
  ruleTitle: string;
  ruleText: string;
  deviations: Step7DeviationRow[];
}

interface Step7RuleGroupsProps {
  groups: RuleGroup[];
  selectedId: string | null;
  onSelect: (deviationId: string) => void;
}

export function groupDeviationsByRule(rows: Step7DeviationRow[]): RuleGroup[] {
  const byRule = new Map<string, RuleGroup>();
  for (const row of rows) {
    const key = row.rule_id || "(no rule)";
    const existing = byRule.get(key);
    if (existing) {
      existing.deviations.push(row);
      continue;
    }
    byRule.set(key, {
      ruleId: row.rule_id,
      ruleTitle: row.rule_title || row.rule_id,
      ruleText: row.rule_text,
      deviations: [row]
    });
  }
  return Array.from(byRule.values()).sort((a, b) =>
    (a.ruleTitle || a.ruleId).localeCompare(b.ruleTitle || b.ruleId)
  );
}

export function Step7RuleGroups({ groups, selectedId, onSelect }: Step7RuleGroupsProps): JSX.Element {
  const selectedRowRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!selectedId) {
      return;
    }
    selectedRowRef.current?.scrollIntoView?.({ block: "nearest", behavior: "smooth" });
  }, [selectedId]);

  if (groups.length === 0) {
    return <p className="step7-muted">No deviations to review.</p>;
  }

  return (
    <div className="step7-rule-groups" role="list">
      {groups.map((group) => (
        <details key={group.ruleId} className="step7-rule-group" open>
          <summary>
            <span>
              {group.ruleTitle}
              <span className="step7-rule-meta"> · {group.ruleId}</span>
            </span>
            <span className="step7-rule-meta">
              {group.deviations.length} deviation{group.deviations.length === 1 ? "" : "s"}
            </span>
          </summary>
          <ul className="step7-deviation-list" role="list">
            {group.deviations.map((row) => (
              <li key={row.deviation_id}>
                <div
                  ref={selectedId === row.deviation_id ? selectedRowRef : undefined}
                  className={`step7-deviation-row ${selectedId === row.deviation_id ? "step7-deviation-row-selected" : ""}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelect(row.deviation_id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onSelect(row.deviation_id);
                    }
                  }}
                >
                  <span className="step7-deviation-id">{row.deviation_id}</span>
                  <p className="step7-deviation-snippet">{row.deviation_text}</p>
                  <span className={`step7-status step7-status-${row.status}`}>{row.status}</span>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
