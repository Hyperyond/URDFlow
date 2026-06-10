import { describe, it, expect } from "vitest";
import { loadURDFFromString } from "../src/loadURDF";
import { findToolFrame } from "../src/tool";
import { gripperArmURDF } from "./fixtures/gripper-arm";
import { twoJointArmURDF } from "./fixtures/two-joint-arm";

// Arm whose URDF declares an explicit TCP frame (like Franka's panda_hand_tcp).
const tcpArmURDF = `<?xml version="1.0"?>
<robot name="tcp_arm">
  <link name="base"/>
  <link name="hand"/>
  <link name="hand_tcp"/>
  <link name="finger1"/>
  <joint name="j1" type="revolute">
    <parent link="base"/><child link="hand"/>
    <origin xyz="0 0 0.2" rpy="0 0 0"/><axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14" effort="1" velocity="1"/>
  </joint>
  <joint name="tcp_joint" type="fixed">
    <parent link="hand"/><child link="hand_tcp"/>
    <origin xyz="0 0 0.1" rpy="0 0 0"/>
  </joint>
  <joint name="finger_joint" type="prismatic">
    <parent link="hand"/><child link="finger1"/>
    <origin xyz="0 0 0.05" rpy="0 0 0"/><axis xyz="1 0 0"/>
    <limit lower="0" upper="0.04" effort="1" velocity="1"/>
  </joint>
</robot>`;

describe("findToolFrame", () => {
  it("prefers an explicit *_tcp leaf link with zero offset", () => {
    const robot = loadURDFFromString(tcpArmURDF);
    const tf = findToolFrame(robot);
    expect(tf.link).toBe("hand_tcp");
    expect(tf.offset).toEqual([0, 0, 0]);
  });

  it("uses the palm link + fingertip-midpoint offset for jaw grippers", () => {
    const robot = loadURDFFromString(gripperArmURDF);
    const tf = findToolFrame(robot);
    // palm = common parent of the two finger joints, NOT a moving finger link
    expect(tf.link).toBe("link1");
    // fingers sit at z=0.3 in link1 frame (boxes 0.05 deep) → grasp center between
    // finger centers and tips, on the symmetry axis
    expect(tf.offset[0]).toBeCloseTo(0, 2);
    expect(tf.offset[1]).toBeCloseTo(0, 2);
    expect(tf.offset[2]).toBeGreaterThan(0.28);
    expect(tf.offset[2]).toBeLessThan(0.34);
    // approach axis points from palm toward the fingertips
    expect(tf.axis[2]).toBeGreaterThan(0.95);
  });

  it("falls back to the leaf link for robots without grippers", () => {
    const robot = loadURDFFromString(twoJointArmURDF);
    const tf = findToolFrame(robot);
    expect(tf.link).toBe("link2");
    expect(tf.offset).toEqual([0, 0, 0]);
  });
});
