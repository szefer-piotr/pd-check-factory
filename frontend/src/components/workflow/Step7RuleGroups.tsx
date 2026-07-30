import { useEffect, useRef } from "react";
import type { Step7DeviationRow } from "../../services/stepApi";

export type ManualOrProgrammable = NonNullable<Step7DeviationRow["manual_or_programmable"]>;

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
  isBulkGeneratingPseudo?: boolean;
}

const PROG_SHORT_LABEL: Record<Exclude<ManualOrProgrammable, "">, string> = {
  Programmable: "Programmable",
  "Partially programmable": "Partial",
  Manual: "Manual"
};

export function programmabilitySlug(
  label: Step7DeviationRow["manual_or_programmable"] | undefined
): "programmable" | "partial" | "manual" | "" {
  if (label === "Programmable") {
    return "programmable";
  }
  if (label === "Partially programmable") {
    return "partial";
  }
  if (label === "Manual") {
    return "manual";
  }
  return "";
}

function ProgrammabilityBadge({ row }: { row: Step7DeviationRow }): JSX.Element | null {
  const label = row.manual_or_programmable;
  const slug = programmabilitySlug(label);
  if (!label || !slug) {
    return null;
  }
  return (
    <span
      className={`step7-prog-badge step7-prog-badge-${slug}`}
      title={label}
      aria-label={`Programmability: ${label}`}
    >
      {PROG_SHORT_LABEL[label]}
    </span>
  );
}

function PseudoIndicator({
  row,
  isBulkGeneratingPseudo
}: {
  row: Step7DeviationRow;
  isBulkGeneratingPseudo: boolean;
}): JSX.Element | null {
  if (row.pseudo_logic) {
    const label = row.manual_or_programmable;
    let ariaLabel = "Pseudo logic generated";
    let warn = false;
    if (label === "Programmable") {
      ariaLabel = "Pseudo logic generated (programmable)";
    } else if (label === "Partially programmable") {
      ariaLabel = "Pseudo logic generated (partially programmable)";
      warn = true;
    } else if (label === "Manual") {
      ariaLabel = "Pseudo logic generated (manual)";
      warn = true;
    } else if (row.programmable === true) {
      ariaLabel = "Pseudo logic generated (programmable)";
    } else if (row.programmable === false) {
      ariaLabel = "Pseudo logic generated (non-programmable)";
      warn = true;
    }
    return (
      <span
        className={`step7-pseudo-icon step7-pseudo-icon-ready ${warn ? "step7-pseudo-icon-warn" : ""}`}
        title={row.pseudo_logic.slice(0, 160)}
        aria-label={ariaLabel}
      >
        {"{ }"}
      </span>
    );
  }

  if (row.status !== "accepted") {
    return null;
  }

  if (row.manual_or_programmable === "Manual") {
    return (
      <span className="step7-pseudo-icon step7-pseudo-icon-empty" aria-label="Manual check — no pseudo logic">
        ∅
      </span>
    );
  }

  if (isBulkGeneratingPseudo) {
    return (
      <span className="step7-pseudo-icon step7-pseudo-icon-generating" aria-label="Generating pseudo logic">
        <span className="upload-spinner" aria-hidden="true" />
      </span>
    );
  }

  return (
    <span className="step7-pseudo-icon step7-pseudo-icon-empty" aria-label="No pseudo logic yet">
      ∅
    </span>
  );
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

export function Step7RuleGroups({
  groups,
  selectedId,
  onSelect,
  isBulkGeneratingPseudo = false
}: Step7RuleGroupsProps): JSX.Element {
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
                  <div className="step7-deviation-row-trailing">
                    <ProgrammabilityBadge row={row} />
                    <PseudoIndicator row={row} isBulkGeneratingPseudo={isBulkGeneratingPseudo} />
                    <span className={`step7-status step7-status-${row.status}`}>{row.status}</span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </details>
      ))}
    </div>
  );
}
