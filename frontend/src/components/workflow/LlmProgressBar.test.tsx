import { render, screen } from "@testing-library/react";
import { LlmProgressBar } from "./LlmProgressBar";

describe("LlmProgressBar", () => {
  it("renders determinate progress for rule extraction", () => {
    render(
      <LlmProgressBar
        progress={{
          phase: "extract-deviations",
          current: 7,
          total: 42,
          unit: "rules",
          label: "rule-007"
        }}
      />
    );

    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "7");
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuemax", "42");
    expect(screen.getByText(/7 \/ 42 rules/i)).toBeInTheDocument();
    expect(screen.getByText("17%")).toBeInTheDocument();
  });

  it("returns null when total is zero", () => {
    const { container } = render(
      <LlmProgressBar
        progress={{
          phase: "extract-deviations",
          current: 0,
          total: 0,
          unit: "rules"
        }}
      />
    );
    expect(container).toBeEmptyDOMElement();
  });
});
