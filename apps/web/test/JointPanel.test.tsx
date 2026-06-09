import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { JointInfo } from "@urdflow/urdf-web";
import { JointPanel } from "../components/JointPanel";

const model: JointInfo[] = [
  { name: "joint1", type: "revolute", lower: -1.57, upper: 1.57 },
  { name: "joint2", type: "revolute", lower: -1.0, upper: 1.0 },
];

describe("JointPanel", () => {
  it("renders one labeled slider per joint with correct min/max", () => {
    render(<JointPanel model={model} values={{}} onChange={() => {}} />);
    const sliders = screen.getAllByRole("slider");
    expect(sliders).toHaveLength(2);
    expect(sliders[0]).toHaveAttribute("min", "-1.57");
    expect(sliders[0]).toHaveAttribute("max", "1.57");
    expect(screen.getByText("joint1")).toBeInTheDocument();
  });

  it("calls onChange with the joint name and new value", () => {
    const onChange = vi.fn();
    render(<JointPanel model={model} values={{}} onChange={onChange} />);
    fireEvent.change(screen.getAllByRole("slider")[0], { target: { value: "0.5" } });
    expect(onChange).toHaveBeenCalledWith("joint1", 0.5);
  });
});
