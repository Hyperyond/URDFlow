import { describe, it, expect } from "vitest";
import { interpolateKeyframes, sampleTrajectory, type Keyframe } from "../src/trajectory";

const kfs: Keyframe[] = [
  { t: 0, position: [0, 0, 0], quaternion: [0, 0, 0, 1], gripper: 0 },
  { t: 1, position: [2, 0, 0], quaternion: [0, 0, 0, 1], gripper: 1 },
];

describe("interpolateKeyframes", () => {
  it("lerps position and gripper at the midpoint", () => {
    const p = interpolateKeyframes(kfs, 0.5);
    expect(p.position[0]).toBeCloseTo(1, 6);
    expect(p.gripper).toBeCloseTo(0.5, 6);
  });
  it("clamps before first / after last keyframe", () => {
    expect(interpolateKeyframes(kfs, -1).position[0]).toBeCloseTo(0, 6);
    expect(interpolateKeyframes(kfs, 5).position[0]).toBeCloseTo(2, 6);
  });
});

describe("sampleTrajectory", () => {
  it("samples at the given fps over the keyframe span", () => {
    const frames = sampleTrajectory(kfs, 10);
    expect(frames.length).toBe(11);
    expect(frames[0]!.t).toBeCloseTo(0, 6);
    expect(frames[frames.length - 1]!.t).toBeCloseTo(1, 6);
    expect(frames[5]!.position[0]).toBeCloseTo(1, 1);
  });
});
