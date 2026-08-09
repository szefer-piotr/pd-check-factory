import { describe, expect, it } from "vitest";
import type { Step7DeviationRow } from "../../services/stepApi";
import {
  EMPTY_DEVIATION_REVIEW_FILTERS,
  deviationFiltersAreActive,
  filterDeviationRows
} from "./deviationFilters";

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

describe("filterDeviationRows", () => {
  const rows = [
    sampleRow({
      deviation_id: "dev-a",
      status: "accepted",
      manual_or_programmable: "Programmable",
      pseudo_logic: "IF x THEN y",
      dm_comment: "ok"
    }),
    sampleRow({
      deviation_id: "dev-b",
      status: "rejected",
      manual_or_programmable: "Manual",
      pseudo_logic: "",
      dm_comment: ""
    }),
    sampleRow({
      deviation_id: "dev-c",
      status: "to_review",
      manual_or_programmable: "Partially programmable",
      deviation_text: "Missing visit window",
      pseudo_logic: ""
    })
  ];

  it("returns all rows with empty filters", () => {
    expect(filterDeviationRows(rows, EMPTY_DEVIATION_REVIEW_FILTERS)).toHaveLength(3);
    expect(deviationFiltersAreActive(EMPTY_DEVIATION_REVIEW_FILTERS)).toBe(false);
  });

  it("filters by status, programmability, pseudo, and comment", () => {
    expect(
      filterDeviationRows(rows, {
        ...EMPTY_DEVIATION_REVIEW_FILTERS,
        status: "accepted",
        programmability: "Programmable",
        pseudo: "has",
        comment: "has"
      }).map((row) => row.deviation_id)
    ).toEqual(["dev-a"]);
  });

  it("filters by search text", () => {
    expect(
      filterDeviationRows(rows, {
        ...EMPTY_DEVIATION_REVIEW_FILTERS,
        search: "visit window"
      }).map((row) => row.deviation_id)
    ).toEqual(["dev-c"]);
    expect(
      deviationFiltersAreActive({
        ...EMPTY_DEVIATION_REVIEW_FILTERS,
        search: "visit"
      })
    ).toBe(true);
  });
});
