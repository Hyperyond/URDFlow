import { describe, it, expect } from "vitest";
import { loadURDFFromString } from "../src/loadURDF";
import { findEndEffectorLink } from "../src/ik";
import { sampleTrajectory, type Keyframe } from "../src/trajectory";
import { retargetTrajectory, toLeRobotFrames } from "../src/retarget";
import { twoJointArmURDF } from "./fixtures/two-joint-arm";

describe("retargetTrajectory", () => {
  it("produces one joint frame per sample with the right shape", () => {
    const robot = loadURDFFromString(twoJointArmURDF);
    const joints = ["joint1", "joint2"];
    const ee = findEndEffectorLink(robot);
    const kfs: Keyframe[] = [
      { t: 0, position: [0, 0, 0.5], quaternion: [0, 0, 0, 1], gripper: 0 },
      { t: 1, position: [0.05, 0, 0.5], quaternion: [0, 0, 0, 1], gripper: 1 },
    ];
    const samples = sampleTrajectory(kfs, 10);
    const jointFrames = retargetTrajectory(robot, ee, joints, samples);
    expect(jointFrames.length).toBe(samples.length);
    expect(Object.keys(jointFrames[0]!.joints).sort()).toEqual(joints);
    expect(jointFrames[0]!.gripper).toBeCloseTo(0, 6);
    expect(jointFrames[jointFrames.length - 1]!.gripper).toBeCloseTo(1, 6);
  });
});

describe("toLeRobotFrames", () => {
  it("emits observation.state / action / timestamp per frame", () => {
    const jf = [
      { t: 0, joints: { j1: 0.1, j2: 0.2 }, gripper: 0 },
      { t: 0.1, joints: { j1: 0.15, j2: 0.25 }, gripper: 1 },
    ];
    const frames = toLeRobotFrames(jf, ["j1", "j2"], 0);
    expect(frames.length).toBe(2);
    expect(frames[0]!["observation.state"]).toEqual([0.1, 0.2, 0]);
    expect(frames[0]!.action).toEqual([0.15, 0.25, 1]);
    expect(frames[1]!.action).toEqual([0.15, 0.25, 1]); // last frame repeats its own state
    expect(frames[0]!.timestamp).toBeCloseTo(0, 6);
    expect(frames[0]!.frame_index).toBe(0);
    expect(frames[0]!.episode_index).toBe(0);
  });
});
