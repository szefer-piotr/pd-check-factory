import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Step7DeviationRow } from "../../services/stepApi";
import * as stepApi from "../../services/stepApi";
import { Step7DeviationDrawer } from "./Step7DeviationDrawer";

vi.mock("../../services/stepApi", async (importOriginal) => {
  const actual = await importOriginal<typeof stepApi>();
  return {
    ...actual,
    fetchStep7DeviationChat: vi.fn(async () => ({
      studyId: "TEST",
      deviationId: "dev-0001",
      messages: []
    })),
    fetchStep7EnrichmentDetail: vi.fn(async () => ({
      studyId: "TEST",
      deviationId: "dev-0001",
      detail: {}
    }))
  };
});

function sampleRow(): Step7DeviationRow {
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
    status: "accepted",
    pseudo_logic: "",
    dm_comment: "",
    entry_source: "generated",
    programmable: null,
    programmability_note: ""
  };
}

describe("Step7DeviationDrawer", () => {
  it("shows a disabled code generation stub action", async () => {
    render(
      <Step7DeviationDrawer
        studyId="TEST"
        reviewSource="generated"
        row={sampleRow()}
        onClose={() => undefined}
        onRowUpdated={() => undefined}
        onStepStatusesChange={() => undefined}
      />
    );
    const stubButton = await screen.findByRole("button", { name: /Generate Code and Preview Results/i });
    expect(stubButton).toBeDisabled();
  });
});
