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
    paragraph_refs_text: "p1",
    supporting_sentences: [],
    data_support_note: "",
    dm_comment: "",
    status: "accepted",
    pseudo_logic: "",
    programmable: null,
    entry_source: "extracted",
    programmability_note: "",
    ...overrides
  } as Step7DeviationRow;
}

describe("Step7RuleGroups", () => {
  it("shows pseudo ready icon when pseudo_logic is present", () => {
    const groups = groupDeviationsByRule([
      sampleRow({
        pseudo_logic: "IF dose > max THEN flag",
        programmable: true,
        manual_or_programmable: "Programmable"
      })
    ]);
    render(<Step7RuleGroups groups={groups} selectedId={null} onSelect={() => undefined} />);
    expect(screen.getByLabelText(/Pseudo logic generated \(programmable\)/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Programmability: Programmable/i)).toBeInTheDocument();
  });

  it("shows partial badge and warn aria when partially programmable with logic", () => {
    const groups = groupDeviationsByRule([
      sampleRow({
        pseudo_logic: "FLAG candidates WHERE dose missing",
        programmable: false,
        manual_or_programmable: "Partially programmable"
      })
    ]);
    render(<Step7RuleGroups groups={groups} selectedId={null} onSelect={() => undefined} />);
    expect(
      screen.getByLabelText(/Pseudo logic generated \(partially programmable\)/i)
    ).toBeInTheDocument();
    expect(screen.getByLabelText(/Programmability: Partially programmable/i)).toBeInTheDocument();
    expect(screen.getByText("Partial")).toBeInTheDocument();
  });

  it("shows manual badge and empty pseudo icon without non-programmable ready label", () => {
    const groups = groupDeviationsByRule([
      sampleRow({
        programmable: false,
        manual_or_programmable: "Manual"
      })
    ]);
    render(<Step7RuleGroups groups={groups} selectedId={null} onSelect={() => undefined} />);
    expect(screen.getByLabelText(/Manual check — no pseudo logic/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/Programmability: Manual/i)).toBeInTheDocument();
    expect(screen.queryByLabelText(/non-programmable/i)).not.toBeInTheDocument();
  });

  it("shows empty pseudo icon for accepted deviations without pseudo", () => {
    const groups = groupDeviationsByRule([sampleRow()]);
    render(<Step7RuleGroups groups={groups} selectedId={null} onSelect={() => undefined} />);
    expect(screen.getByLabelText(/No pseudo logic yet/i)).toBeInTheDocument();
  });
});
