import { describe, it, expect } from "vitest";
import { loadURDFFromString } from "../src/loadURDF";
import { findGripperJoints, applyGripper, closureForWidth } from "../src/gripper";
import { gripperArmURDF } from "./fixtures/gripper-arm";
import { twoJointArmURDF } from "./fixtures/two-joint-arm";

describe("findGripperJoints", () => {
  it("finds prismatic finger joints by name", () => {
    const robot = loadURDFFromString(gripperArmURDF);
    const g = findGripperJoints(robot);
    expect(g.map((j) => j.name)).toEqual(["panda_finger_joint1", "panda_finger_joint2"]);
    expect(g[0]!.upper).toBeCloseTo(0.04, 6);
    expect(g[0]!.lower).toBeCloseTo(0, 6);
  });
  it("returns [] when the robot has no gripper", () => {
    const robot = loadURDFFromString(twoJointArmURDF);
    expect(findGripperJoints(robot)).toEqual([]);
  });
});

describe("applyGripper", () => {
  it("opens at 0 (upper) and closes at 1 (lower)", () => {
    const robot = loadURDFFromString(gripperArmURDF);
    const g = findGripperJoints(robot);
    applyGripper(robot, g, 0);
    expect(robot.joints["panda_finger_joint1"]!.angle as number).toBeCloseTo(0.04, 4);
    applyGripper(robot, g, 1);
    expect(robot.joints["panda_finger_joint1"]!.angle as number).toBeCloseTo(0, 4);
  });
});

describe("closureForWidth", () => {
  it("stops a prismatic parallel jaw exactly at the object width", () => {
    const robot = loadURDFFromString(gripperArmURDF);
    const g = findGripperJoints(robot);
    // total travel = 0.04 + 0.04 = 0.08; closing on a 0.05-wide cube leaves
    // each finger 0.025 from closed → closure = 1 - 0.05/0.08
    expect(closureForWidth(g, 0.05)).toBeCloseTo(0.375, 4);
    expect(closureForWidth(g, 0)).toBeCloseTo(1, 6);
    expect(closureForWidth(g, 0.2)).toBe(0); // wider than the jaws can open
  });

  it("falls back to a partial close for revolute jaws", () => {
    const revolute = [{ name: "jaw", lower: 0, upper: 1.2, type: "revolute" as const }];
    const v = closureForWidth(revolute, 0.05);
    expect(v).toBeGreaterThan(0.5);
    expect(v).toBeLessThan(1);
  });
});

describe("findGripperJoints via link names (PiPER-style)", () => {
  // fingers named joint7/joint8 — only the parent link "gripper_base" reveals them
  const piperStyle = `<?xml version="1.0"?>
<robot name="piper_mini">
  <link name="base"/>
  <link name="link6"/>
  <link name="gripper_base"/>
  <link name="link7"/>
  <link name="link8"/>
  <joint name="joint6" type="revolute">
    <parent link="base"/><child link="link6"/>
    <origin xyz="0 0 0.2" rpy="0 0 0"/><axis xyz="0 0 1"/>
    <limit lower="-3" upper="3" effort="1" velocity="1"/>
  </joint>
  <joint name="joint6_to_gripper_base" type="fixed">
    <parent link="link6"/><child link="gripper_base"/>
    <origin xyz="0 0 0.05" rpy="0 0 0"/>
  </joint>
  <joint name="joint7" type="prismatic">
    <parent link="gripper_base"/><child link="link7"/>
    <origin xyz="0 0.02 0.08" rpy="0 0 0"/><axis xyz="0 1 0"/>
    <limit lower="0" upper="0.035" effort="1" velocity="1"/>
  </joint>
  <joint name="joint8" type="prismatic">
    <parent link="gripper_base"/><child link="link8"/>
    <origin xyz="0 -0.02 0.08" rpy="0 0 0"/><axis xyz="0 -1 0"/>
    <limit lower="-0.035" upper="0" effort="1" velocity="1"/>
  </joint>
</robot>`;

  it("detects leaf finger joints under a gripper-named parent link", () => {
    const robot = loadURDFFromString(piperStyle);
    const g = findGripperJoints(robot);
    expect(g.map((j) => j.name)).toEqual(["joint7", "joint8"]);
  });

  it("does not classify the arm joint as a gripper joint", () => {
    const robot = loadURDFFromString(piperStyle);
    const g = findGripperJoints(robot);
    expect(g.some((j) => j.name === "joint6")).toBe(false);
  });
});
