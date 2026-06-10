import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Actuator, JointSignal } from "@urdflow/urdf-web";
import { SignalPanel } from "../components/SignalPanel";

const actuators: Actuator[] = [{ name: "j1", position: 0.5, target: 1, maxVel: 1 }];
const signals: JointSignal[] = [
  { name: "j1", encoder: 0.5, moving: true, atTarget: false, atLowerLimit: false, atUpperLimit: false },
];

describe("SignalPanel", () => {
  it("renders a status row per joint with mono encoder readout", () => {
    render(<SignalPanel actuators={actuators} signals={signals} onHome={() => {}} onStop={() => {}} />);
    expect(screen.getByText("j1")).toBeInTheDocument();
    expect(screen.getByText("0.50")).toBeInTheDocument();
    expect(screen.getByLabelText("j1 moving")).toBeInTheDocument();
  });

  it("fires onHome and onStop", () => {
    const onHome = vi.fn();
    const onStop = vi.fn();
    render(<SignalPanel actuators={actuators} signals={signals} onHome={onHome} onStop={onStop} />);
    fireEvent.click(screen.getByRole("button", { name: /home/i }));
    fireEvent.click(screen.getByRole("button", { name: /stop/i }));
    expect(onHome).toHaveBeenCalled();
    expect(onStop).toHaveBeenCalled();
  });
});
