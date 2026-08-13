import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { RulesWorkspace } from "./RulesWorkspace";

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

vi.mock("../viewers/ParagraphViewer", () => ({
  ParagraphViewer: ({ focusRef }: { focusRef?: string }) => (
    <div>Protocol pane focus={focusRef ?? ""}</div>
  )
}));

describe("RulesWorkspace", () => {
  it("switches to protocol pane when a paragraph ref is opened", () => {
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
    fireEvent.click(screen.getByRole("button", { name: "Open p34" }));
    expect(screen.getByText("Protocol pane focus=p34")).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Protocol" })).toHaveAttribute("aria-selected", "true");
  });
});
