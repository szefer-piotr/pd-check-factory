import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RulesList } from "./RulesList";

vi.mock("../../services/paragraphCache", () => ({
  getParagraphTextMap: vi.fn(async () =>
    new Map([
      ["p34", "All concomitant medications must be recorded in the eCRF from Screening through Day 15."]
    ])
  )
}));

describe("RulesList paragraph references", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows full paragraph text and opens a ref via chip click", async () => {
    const onOpenParagraphRef = vi.fn();
    render(
      <RulesList
        studyId="STUDY-1"
        selectedId="rule-015"
        onSelect={vi.fn()}
        onOpenParagraphRef={onOpenParagraphRef}
        rules={[
          {
            rule_id: "rule-015",
            title: "Concomitant medication recording",
            text: "All medications taken from Screening through Day 15 must be recorded.",
            paragraph_refs: ["p34"]
          }
        ]}
      />
    );

    expect(screen.queryByText("Supporting information")).not.toBeInTheDocument();
    expect(screen.getByText("Paragraph references")).toBeInTheDocument();

    await waitFor(() => {
      expect(
        screen.getByText(
          "All concomitant medications must be recorded in the eCRF from Screening through Day 15."
        )
      ).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "p34" }));
    expect(onOpenParagraphRef).toHaveBeenCalledWith("p34", ["p34"]);
  });
});
