import { render, screen, waitFor } from "@testing-library/react";
import { ExtractionLiveFeed } from "./ExtractionLiveFeed";
import * as stepApi from "../../services/stepApi";

vi.mock("../../services/stepApi", async () => {
  const actual = await vi.importActual<typeof stepApi>("../../services/stepApi");
  return {
    ...actual,
    fetchExtractionLive: vi.fn()
  };
});

const longText = "Z".repeat(200);

function buildLiveResponse(partial: boolean): stepApi.ExtractionLiveResponse {
  const deviations = Array.from({ length: 15 }, (_, index) => ({
    deviation_id: `dev-${String(index + 1).padStart(4, "0")}`,
    rule_id: `rule-${String((index % 3) + 1).padStart(3, "0")}`,
    text: `${longText}-${index + 1}`,
    paragraph_refs: ["p1"],
    data_support_note: "",
    status: "pending"
  }));

  return {
    studyId: "MY-STUDY",
    rules: [
      {
        rule_id: "rule-001",
        title: "Rule one",
        text: longText,
        paragraph_refs: ["p1"]
      }
    ],
    deviations,
    ruleCount: 1,
    deviationCount: 15,
    partial,
    completedRuleIds: partial ? ["rule-001"] : [],
    llmProgress: null,
    runStatus: partial ? "running" : "idle"
  };
}

describe("ExtractionLiveFeed", () => {
  beforeEach(() => {
    vi.mocked(stepApi.fetchExtractionLive).mockResolvedValue(buildLiveResponse(true));
  });

  it("renders all deviations with full text when partial extraction is in progress", async () => {
    render(<ExtractionLiveFeed studyId="MY-STUDY" active />);

    await waitFor(() => {
      expect(screen.getByText("updating…")).toBeInTheDocument();
    });

    for (let index = 1; index <= 15; index += 1) {
      expect(screen.getByText(`${longText}-${index}`)).toBeInTheDocument();
    }

    expect(screen.queryByText(`${longText.slice(0, 120)}…`)).not.toBeInTheDocument();
  });

  it("does not render when inactive and no partial snapshot exists", async () => {
    vi.mocked(stepApi.fetchExtractionLive).mockResolvedValue({
      studyId: "MY-STUDY",
      rules: [],
      deviations: [],
      ruleCount: 0,
      deviationCount: 0,
      partial: false,
      completedRuleIds: [],
      llmProgress: null,
      runStatus: "idle"
    });

    const { container } = render(<ExtractionLiveFeed studyId="MY-STUDY" active={false} />);
    expect(container).toBeEmptyDOMElement();
  });
});
