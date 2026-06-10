import { describe, it, expect } from "vitest";
import { Vector3 } from "three";
import { loadURDFFromString } from "../src/loadURDF";
import { findEndEffectorLink } from "../src/ik";
import { planGrasp, buildGraspTrajectory } from "../src/grasp";
import { twoJointArmURDF } from "./fixtures/two-joint-arm";

describe("planGrasp", () => {
  it("finds a reachable grasp for a box near the workspace", () => {
    const robot = loadURDFFromString(twoJointArmURDF);
    const ee = findEndEffectorLink(robot);
    const joints = ["joint1", "joint2"];
    robot.setJointValue("joint1", 0);
    robot.setJointValue("joint2", 0);
    robot.updateMatrixWorld(true);
    const home = robot.links["link2"]!.getWorldPosition(new Vector3()).toArray() as [number, number, number];
    const plan = planGrasp(robot, ee, joints, home, { candidates: 24, reachThreshold: 0.05 });
    expect(plan).not.toBeNull();
    expect(plan!.graspPos[0]).toBeCloseTo(home[0], 5);
  });

  it("returns null when the box is far out of reach", () => {
    const robot = loadURDFFromString(twoJointArmURDF);
    const ee = findEndEffectorLink(robot);
    const plan = planGrasp(robot, ee, ["joint1", "joint2"], [10, 10, 10], { candidates: 24, reachThreshold: 0.05 });
    expect(plan).toBeNull();
  });
});

describe("buildGraspTrajectory", () => {
  it("emits pre-grasp(open) → grasp(open) → close → lift(closed)", () => {
    const plan = {
      approachDir: [0, 1, 0] as [number, number, number],
      graspPos: [0, 0.5, 0] as [number, number, number],
      graspQuat: [0, 0, 0, 1] as [number, number, number, number],
      prePos: [0, 0.6, 0] as [number, number, number],
    };
    const kfs = buildGraspTrajectory(plan, { liftHeight: 0.15 });
    expect(kfs.map((k) => k.gripper)).toEqual([0, 0, 1, 1]);
    expect(kfs[1]!.position).toEqual([0, 0.5, 0]);
    expect(kfs[3]!.position[1]).toBeCloseTo(0.65, 6);
  });

  it("prepends a home keyframe so playback eases in (no jump)", () => {
    const plan = {
      approachDir: [0, 1, 0] as [number, number, number],
      graspPos: [0, 0.5, 0] as [number, number, number],
      graspQuat: [0, 0, 0, 1] as [number, number, number, number],
      prePos: [0, 0.6, 0] as [number, number, number],
    };
    const kfs = buildGraspTrajectory(plan, { homePos: [0, 1, 0], liftHeight: 0.15 });
    expect(kfs).toHaveLength(5);
    expect(kfs[0]!.position).toEqual([0, 1, 0]);
    expect(kfs.map((k) => k.gripper)).toEqual([0, 0, 0, 1, 1]);
    expect(kfs[kfs.length - 1]!.t).toBeGreaterThan(5); // slowed down, ~5.3s
  });
});
