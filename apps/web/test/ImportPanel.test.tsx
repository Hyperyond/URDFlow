import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ImportPanel } from "../components/ImportPanel";

describe("ImportPanel", () => {
  it("calls onPickFiles when a folder is selected", () => {
    const onPickFiles = vi.fn();
    render(<ImportPanel onPickFiles={onPickFiles} onPickZip={() => {}} busy={false} />);
    const input = screen.getByTestId("folder-input") as HTMLInputElement;
    const file = new File(["x"], "robot.urdf");
    fireEvent.change(input, { target: { files: [file] } });
    expect(onPickFiles).toHaveBeenCalled();
  });

  it("shows a loading label when busy", () => {
    render(<ImportPanel onPickFiles={() => {}} onPickZip={() => {}} busy={true} />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });
});
