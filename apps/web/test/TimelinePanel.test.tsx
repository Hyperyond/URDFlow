import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { Keyframe } from "@urdflow/urdf-web";
import { TimelinePanel } from "../components/TimelinePanel";

const kfs: Keyframe[] = [
  { t: 0, position: [0, 0, 0], quaternion: [0, 0, 0, 1], gripper: 0 },
  { t: 1, position: [0, 0, 0], quaternion: [0, 0, 0, 1], gripper: 1 },
];

function setup(overrides: Partial<React.ComponentProps<typeof TimelinePanel>> = {}) {
  const props = {
    keyframes: kfs,
    playhead: 0,
    duration: 1,
    isPlaying: false,
    onAddKeyframe: vi.fn(),
    onRemoveKeyframe: vi.fn(),
    onPlay: vi.fn(),
    onPause: vi.fn(),
    onExport: vi.fn(),
    ...overrides,
  };
  render(<TimelinePanel {...props} />);
  return props;
}

describe("TimelinePanel", () => {
  it("renders one row per keyframe with its time", () => {
    setup();
    expect(screen.getByText("0.00s")).toBeInTheDocument();
    expect(screen.getByText("1.00s")).toBeInTheDocument();
  });

  it("fires add / play / export callbacks", () => {
    const p = setup();
    fireEvent.click(screen.getByRole("button", { name: /add keyframe/i }));
    fireEvent.click(screen.getByRole("button", { name: /play/i }));
    fireEvent.click(screen.getByRole("button", { name: /export/i }));
    expect(p.onAddKeyframe).toHaveBeenCalled();
    expect(p.onPlay).toHaveBeenCalled();
    expect(p.onExport).toHaveBeenCalled();
  });

  it("removes a keyframe by index", () => {
    const p = setup();
    fireEvent.click(screen.getAllByRole("button", { name: /remove keyframe/i })[1]!);
    expect(p.onRemoveKeyframe).toHaveBeenCalledWith(1);
  });
});
