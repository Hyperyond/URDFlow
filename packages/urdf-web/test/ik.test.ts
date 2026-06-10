import { describe, it, expect } from "vitest";
import { Vector3, Quaternion } from "three";
import { loadURDFFromString } from "../src/loadURDF";
import { findEndEffectorLink, solveIK, naturalRestPose, toolWorldPosition } from "../src/ik";
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

describe("solveIK with tcpOffset", () => {
  it("drives the offset tool point (not the link origin) to the target", () => {
    const robot = loadURDFFromString(twoJointArmURDF);
    const joints = ["joint1", "joint2"];
    const offset: [number, number, number] = [0, 0, 0.15];
    // target = TCP pose at a known configuration
    robot.setJointValue("joint1", 0.4);
    robot.setJointValue("joint2", -0.6);
    robot.updateMatrixWorld(true);
    const tp = toolWorldPosition(robot, "link2", offset);
    const tq = robot.links["link2"]!.getWorldQuaternion(new Quaternion());
    robot.setJointValue("joint1", 0);
    robot.setJointValue("joint2", 0);
    solveIK(robot, "link2", joints, [tp.x, tp.y, tp.z], [tq.x, tq.y, tq.z, tq.w], {
      iterations: 80,
      lambda: 0.05,
      tcpOffset: offset,
    });
    robot.updateMatrixWorld(true);
    const reached = toolWorldPosition(robot, "link2", offset);
    expect(reached.distanceTo(tp)).toBeLessThan(0.02);
    // and the link origin is NOT at the target (the offset did the work)
    const origin = robot.links["link2"]!.getWorldPosition(new Vector3());
    expect(origin.distanceTo(tp)).toBeGreaterThan(0.05);
  });

  it("escapes a joint limit (finite difference works at the clamp boundary)", () => {
    const robot = loadURDFFromString(twoJointArmURDF);
    const joints = ["joint1", "joint2"];
    robot.setJointValue("joint1", 0.2);
    robot.setJointValue("joint2", 0.5);
    robot.updateMatrixWorld(true);
    const tp = robot.links["link2"]!.getWorldPosition(new Vector3());
    const tq = robot.links["link2"]!.getWorldQuaternion(new Quaternion());
    // start parked AT the upper limit of joint2 — naive +delta probing stalls here
    robot.setJointValue("joint1", 0);
    robot.setJointValue("joint2", 1.0);
    solveIK(robot, "link2", joints, [tp.x, tp.y, tp.z], [tq.x, tq.y, tq.z, tq.w], {
      iterations: 80,
      lambda: 0.05,
    });
    robot.updateMatrixWorld(true);
    const reached = robot.links["link2"]!.getWorldPosition(new Vector3());
    expect(reached.distanceTo(tp)).toBeLessThan(0.02);
  });
});

describe("naturalRestPose", () => {
  it("uses the limit midpoint when 0 is outside the limits (Panda elbow case)", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="elbow">
  <link name="a"/><link name="b"/>
  <joint name="elbow" type="revolute">
    <parent link="a"/><child link="b"/>
    <origin xyz="0 0 0.1" rpy="0 0 0"/><axis xyz="0 1 0"/>
    <limit lower="-3.07" upper="-0.07" effort="1" velocity="1"/>
  </joint>
</robot>`;
    const robot = loadURDFFromString(urdf);
    const [q] = naturalRestPose(robot, ["elbow"]);
    expect(q).toBeCloseTo((-3.07 - 0.07) / 2, 3);
  });

  it("keeps 0 when it sits comfortably inside the limits", () => {
    const robot = loadURDFFromString(twoJointArmURDF);
    expect(naturalRestPose(robot, ["joint1", "joint2"])).toEqual([0, 0]);
  });

  it("nudges off a limit boundary when 0 sits exactly on it", () => {
    const urdf = `<?xml version="1.0"?>
<robot name="edge">
  <link name="a"/><link name="b"/>
  <joint name="lift" type="revolute">
    <parent link="a"/><child link="b"/>
    <origin xyz="0 0 0.1" rpy="0 0 0"/><axis xyz="0 1 0"/>
    <limit lower="0" upper="3.2" effort="1" velocity="1"/>
  </joint>
</robot>`;
    const robot = loadURDFFromString(urdf);
    const [q] = naturalRestPose(robot, ["lift"]);
    expect(q).toBeGreaterThan(0.05);
    expect(q).toBeLessThan(0.5);
  });
});
