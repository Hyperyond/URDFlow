import { describe, it, expect } from "vitest";
import { Vector3, Quaternion } from "three";
import { loadURDFFromString } from "../src/loadURDF";
import { findEndEffectorLink, solveIK } from "../src/ik";
import { twoJointArmURDF } from "./fixtures/two-joint-arm";
import { threeJointArmURDF } from "./fixtures/three-joint-arm";

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

  it("null-space rest-pose bias keeps the target while biasing joints toward rest", () => {
    const robot = loadURDFFromString(threeJointArmURDF);
    const ee = findEndEffectorLink(robot);
    const joints = ["j1", "j2", "j3"];
    const restSol = [0.4, 0.6, -0.5];
    joints.forEach((n, i) => robot.setJointValue(n, restSol[i]!));
    robot.updateMatrixWorld(true);
    const tp = robot.links[ee]!.getWorldPosition(new Vector3());
    const tq = robot.links[ee]!.getWorldQuaternion(new Quaternion());
    const target: [number, number, number] = [tp.x, tp.y, tp.z];
    const targetQ: [number, number, number, number] = [tq.x, tq.y, tq.z, tq.w];
    joints.forEach((n) => robot.setJointValue(n, 0));
    solveIK(robot, ee, joints, target, targetQ, {
      iterations: 120,
      lambda: 0.04,
      restPose: restSol,
      restGain: 0.1,
    });
    robot.updateMatrixWorld(true);
    const reached = robot.links[ee]!.getWorldPosition(new Vector3());
    expect(reached.distanceTo(tp)).toBeLessThan(0.03); // target still met
    const spread = joints.reduce((s, n, i) => s + Math.abs((robot.joints[n]!.angle as number) - restSol[i]!), 0);
    expect(spread).toBeLessThan(0.8); // pulled toward rest
  });
});
