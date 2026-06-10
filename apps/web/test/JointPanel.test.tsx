import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { JointInfo } from "@urdflow/urdf-web";
import { JointPanel } from "../components/JointPanel";

const model: JointInfo[] = [
  { name: "joint1", type: "revolute", lower: -1.57, upper: 1.57 },
  { name: "joint2", type: "revolute", lower: -1.0, upper: 1.0 },
];

describe("JointPanel", () => {
  it("renders a labeled slider + mono readout per joint", () => {
    render(
      <JointPanel
        model={model}
        values={{ joint1: 0.5 }}
        onChange={() => {}}
        onReset={() => {}}
        onResetAll={() => {}}
      />,
    );
    expect(screen.getAllByRole("slider")).toHaveLength(2);
    expect(screen.getByText("joint1")).toBeInTheDocument();
    expect(screen.getByText("0.50")).toBeInTheDocument();
  });

  it("calls onChange with name + numeric value", () => {
    const onChange = vi.fn();
    render(
      <JointPanel model={model} values={{}} onChange={onChange} onReset={() => {}} onResetAll={() => {}} />,
    );
    fireEvent.change(screen.getAllByRole("slider")[0], { target: { value: "0.5" } });
    expect(onChange).toHaveBeenCalledWith("joint1", 0.5);
  });

  it("fires onReset for one joint and onResetAll", () => {
    const onReset = vi.fn();
    const onResetAll = vi.fn();
    render(
      <JointPanel model={model} values={{}} onChange={() => {}} onReset={onReset} onResetAll={onResetAll} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /reset all/i }));
    expect(onResetAll).toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("button", { name: /^reset joint/i })[0]);
    expect(onReset).toHaveBeenCalledWith("joint1");
  });
});
