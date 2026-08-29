import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RulesWorkspace } from "./RulesWorkspace";

const openInspector = vi.fn();
const setProtocolFocus = vi.fn();

vi.mock("../../jobs/PipelineJobContext", () => ({
  usePipelineJobs: () => ({
    openInspector,
    setProtocolFocus
  })
}));

vi.mock("./RulesList", () => ({
  RulesList: ({
    onOpenParagraphRef
  }: {
    onOpenParagraphRef: (refId: string, allRefs: string[]) => void;
  }) => (
    <button type="button" onClick={() => onOpenParagraphRef("p34", ["p34"])}>
      Open p34
    </button>
  )
}));

vi.mock("./RulesListChat", () => ({
  RulesListChat: () => <div>Rules chat pane</div>
}));

describe("RulesWorkspace", () => {
  it("keeps chat in the reading pane and opens inspector for protocol refs", () => {
    render(
      <RulesWorkspace
        studyId="STUDY-1"
        activeVersion="v1"
        chatDeployment="gpt-4o"
        chatKey={1}
        onApplied={vi.fn()}
        rules={[
          {
            rule_id: "rule-015",
            title: "Title",
            text: "Text",
            paragraph_refs: ["p34"]
          }
        ]}
      />
    );

    expect(screen.getByText("Rules chat pane")).toBeInTheDocument();
    expect(screen.queryByRole("tab", { name: "Protocol" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Open p34" }));
    expect(setProtocolFocus).toHaveBeenCalledWith({ focusRef: "p34", highlightRefs: ["p34"] });
    expect(openInspector).toHaveBeenCalledWith("protocol");
    expect(screen.getByText("Rules chat pane")).toBeInTheDocument();
  });
});
