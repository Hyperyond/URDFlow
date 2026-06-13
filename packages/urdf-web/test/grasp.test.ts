import { describe, it, expect } from "vitest";
import { Vector3, Quaternion } from "three";
import { loadURDFFromString } from "../src/loadURDF";
import { findEndEffectorLink } from "../src/ik";
import { planGrasp, buildGraspTrajectory, carryQuat } from "../src/grasp";
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
    const plan = planGrasp(robot, ee, joints, home, { candidates: 24, reachThreshold: 0.05, liftCheckHeight: 0 });
    expect(plan).not.toBeNull();
    expect(plan!.graspPos[0]).toBeCloseTo(home[0], 5);
  });

  it("returns null when the box is far out of reach", () => {
    const robot = loadURDFFromString(twoJointArmURDF);
    const ee = findEndEffectorLink(robot);
    const plan = planGrasp(robot, ee, ["joint1", "joint2"], [10, 10, 10], { candidates: 24, reachThreshold: 0.05, liftCheckHeight: 0 });
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
    // descend → settle dwell (still open) → slow close → lift
    expect(kfs.map((k) => k.gripper)).toEqual([0, 0, 0, 1, 1]);
    expect(kfs[1]!.position).toEqual([0, 0.5, 0]);
    expect(kfs[4]!.position[1]).toBeCloseTo(0.65, 6);
  });

  it("prepends a home keyframe so playback eases in (no jump)", () => {
    const plan = {
      approachDir: [0, 1, 0] as [number, number, number],
      graspPos: [0, 0.5, 0] as [number, number, number],
      graspQuat: [0, 0, 0, 1] as [number, number, number, number],
      prePos: [0, 0.6, 0] as [number, number, number],
    };
    const kfs = buildGraspTrajectory(plan, { homePos: [0, 1, 0], liftHeight: 0.15 });
    expect(kfs).toHaveLength(6);
    expect(kfs[0]!.position).toEqual([0, 1, 0]);
    expect(kfs.map((k) => k.gripper)).toEqual([0, 0, 0, 0, 1, 1]);
    expect(kfs[kfs.length - 1]!.t).toBeGreaterThan(5); // slowed down, ~6.1s
  });
});

describe("planGrasp ground safety", () => {
  it("never approaches from below the horizon and keeps the pre-grasp above ground", () => {
    const robot = loadURDFFromString(twoJointArmURDF);
    const ee = findEndEffectorLink(robot);
    const joints = ["joint1", "joint2"];
    robot.setJointValue("joint1", 0.3);
    robot.setJointValue("joint2", 0.6);
    robot.updateMatrixWorld(true);
    const spot = robot.links["link2"]!.getWorldPosition(new Vector3()).toArray() as [number, number, number];
    robot.setJointValue("joint1", 0);
    robot.setJointValue("joint2", 0);
    for (let i = 0; i < 3; i++) {
      const plan = planGrasp(robot, ee, joints, spot, { candidates: 48, reachThreshold: 0.06, liftCheckHeight: 0 });
      if (!plan) continue;
      expect(plan.approachDir[1]).toBeGreaterThanOrEqual(0.1);
      expect(plan.prePos[1]).toBeGreaterThan(0.01);
    }
  });
});

describe("carryQuat", () => {
  it("keeps a top-down tool axis pointing down while the twist follows the azimuth swing", () => {
    // grasp orientation: tool +Z mapped to world -Y (pointing straight down)
    const down = new Quaternion().setFromUnitVectors(
      new Vector3(0, 0, 1),
      new Vector3(0, -1, 0),
    );
    const g: [number, number, number, number] = [down.x, down.y, down.z, down.w];
    const out = carryQuat(g, [0.3, 0.025, 0], [0, 0.025, 0.3]); // 90° azimuth swing
    const q = new Quaternion(...out);
    const axis = new Vector3(0, 0, 1).applyQuaternion(q);
    expect(axis.y).toBeLessThan(-0.99); // still pointing down
    // the tool's X axis rotated 90° in the XZ plane
    const fx = new Vector3(1, 0, 0).applyQuaternion(new Quaternion(...g));
    const fx2 = new Vector3(1, 0, 0).applyQuaternion(q);
    expect(Math.abs(fx.angleTo(fx2) - Math.PI / 2)).toBeLessThan(1e-6);
  });
});
