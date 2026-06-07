import { render, screen } from "@testing-library/react";
import type { Step7DeviationRow } from "../../services/stepApi";
import { Step7RuleGroups, groupDeviationsByRule } from "./Step7RuleGroups";

function sampleRow(overrides: Partial<Step7DeviationRow> = {}): Step7DeviationRow {
  return {
    deviation_id: "dev-0001",
    rule_id: "rule-001",
    rule_title: "Dosing",
    rule_text: "Dose must match protocol",
    deviation_text: "Check dose",
    paragraph_refs: ["p1"],
    status: "accepted",
    pseudo_logic: "",
    programmable: null,
    ...overrides
  };
}

describe("Step7RuleGroups", () => {
  it("shows pseudo ready icon when pseudo_logic is present", () => {
    const groups = groupDeviationsByRule([
      sampleRow({ pseudo_logic: "IF dose > max THEN flag", programmable: true })
    ]);
    render(<Step7RuleGroups groups={groups} selectedId={null} onSelect={() => undefined} />);
    expect(screen.getByLabelText(/Pseudo logic generated \(programmable\)/i)).toBeInTheDocument();
  });

  it("shows empty pseudo icon for accepted deviations without pseudo", () => {
    const groups = groupDeviationsByRule([sampleRow()]);
    render(<Step7RuleGroups groups={groups} selectedId={null} onSelect={() => undefined} />);
    expect(screen.getByLabelText(/No pseudo logic yet/i)).toBeInTheDocument();
  });
});
