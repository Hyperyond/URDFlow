import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { RobotPicker } from "../components/RobotPicker";
import { PRESETS } from "../lib/presets";

describe("RobotPicker", () => {
  it("lists presets and fires onPick on click", () => {
    const onPick = vi.fn();
    render(<RobotPicker presets={PRESETS} uploaded={[]} activeLabel="UR5" onPick={onPick} />);
    fireEvent.click(screen.getByRole("button", { name: "UR5" }));
    expect(onPick).toHaveBeenCalledWith(PRESETS[0]);
  });

  it("renders uploaded robots tagged as uploaded", () => {
    const onPick = vi.fn();
    render(<RobotPicker presets={PRESETS} uploaded={[{ label: "my-arm" }]} activeLabel="my-arm" onPick={onPick} />);
    expect(screen.getByText("my-arm")).toBeInTheDocument();
    expect(screen.getByText(/uploaded/i)).toBeInTheDocument();
  });
});
