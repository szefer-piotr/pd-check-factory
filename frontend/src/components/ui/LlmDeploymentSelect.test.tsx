import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { LlmDeploymentSelect } from "./LlmDeploymentSelect";

const deployments = [
  { id: "gpt-4o", modelName: "gpt-4o", version: "" },
  { id: "gpt-4.1", modelName: "gpt-4.1", version: "" }
];

describe("LlmDeploymentSelect", () => {
  it("opens a searchable chip menu and selects a model", () => {
    const onChange = vi.fn();
    render(
      <LlmDeploymentSelect
        id="extraction-deployment"
        label="Rules & deviations extraction"
        value="gpt-4o"
        deployments={deployments}
        onChange={onChange}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Rules & deviations extraction/i }));
    expect(screen.getByPlaceholderText("Search models…")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("option", { name: "gpt-4.1" }));
    expect(onChange).toHaveBeenCalledWith("gpt-4.1");
  });
});
