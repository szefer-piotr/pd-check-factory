import type { Step7DeviationRow } from "../services/stepApi";

export interface RuleGroup {
  ruleId: string;
  ruleTitle: string;
  ruleText: string;
  deviations: Step7DeviationRow[];
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
