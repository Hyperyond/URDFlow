import { describe, it, expect } from "vitest";
import { Vector3, Quaternion } from "three";
import { loadURDFFromString } from "../src/loadURDF";
import { findEndEffectorLink, solveIK } from "../src/ik";
import { twoJointArmURDF } from "./fixtures/two-joint-arm";

describe("findEndEffectorLink", () => {
  it("returns the leaf link of the chain", () => {
    const robot = loadURDFFromString(twoJointArmURDF);
    expect(findEndEffectorLink(robot)).toBe("link2");
  });
});

describe("solveIK", () => {
  it("converges to a reachable target pose (position)", () => {
    const robot = loadURDFFromString(twoJointArmURDF);
    const joints = ["joint1", "joint2"];
    // reachable target = FK of a known joint configuration
    robot.setJointValue("joint1", 0.3);
    robot.setJointValue("joint2", -0.4);
    robot.updateMatrixWorld(true);
    const targetPos = robot.links["link2"]!.getWorldPosition(new Vector3()).toArray() as [
      number,
      number,
      number,
    ];
    const targetQuat = robot.links["link2"]!.getWorldQuaternion(new Quaternion()).toArray() as [
      number,
      number,
      number,
      number,
    ];
    robot.setJointValue("joint1", 0);
    robot.setJointValue("joint2", 0);
    solveIK(robot, "link2", joints, targetPos, targetQuat, { iterations: 60, lambda: 0.05 });
    robot.updateMatrixWorld(true);
    const reached = robot.links["link2"]!.getWorldPosition(new Vector3());
    expect(reached.distanceTo(new Vector3(...targetPos))).toBeLessThan(0.02);
  });
});
