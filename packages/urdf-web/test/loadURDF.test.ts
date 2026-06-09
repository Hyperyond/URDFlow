import { describe, it, expect } from "vitest";
import { loadURDFFromString } from "../src/loadURDF";

// Inline content of test/fixtures/two-joint-arm.urdf
const urdf = `<?xml version="1.0"?>
<robot name="two_joint_arm">
  <link name="base_link">
    <visual><geometry><box size="0.2 0.2 0.1"/></geometry></visual>
  </link>
  <link name="link1">
    <visual><geometry><box size="0.1 0.1 0.4"/></geometry></visual>
  </link>
  <link name="link2">
    <visual><geometry><box size="0.1 0.1 0.3"/></geometry></visual>
  </link>
  <joint name="joint1" type="revolute">
    <parent link="base_link"/>
    <child link="link1"/>
    <origin xyz="0 0 0.1" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-1.57" upper="1.57" effort="10" velocity="1"/>
  </joint>
  <joint name="joint2" type="revolute">
    <parent link="link1"/>
    <child link="link2"/>
    <origin xyz="0 0 0.4" rpy="0 0 0"/>
    <axis xyz="0 1 0"/>
    <limit lower="-1.0" upper="1.0" effort="10" velocity="1"/>
  </joint>
</robot>`;

describe("loadURDFFromString", () => {
  it("parses the robot name and both movable joints", () => {
    const robot = loadURDFFromString(urdf);
    expect(robot.robotName).toBe("two_joint_arm");
    expect(Object.keys(robot.joints).sort()).toEqual(["joint1", "joint2"]);
    expect(robot.joints["joint1"]?.jointType).toBe("revolute");
  });

  it("applies Z-up to Y-up by default", () => {
    const robot = loadURDFFromString(urdf);
    expect(robot.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
  });

  it("leaves the frame untouched when convertUpAxis is false", () => {
    const robot = loadURDFFromString(urdf, { convertUpAxis: false });
    expect(robot.rotation.x).toBeCloseTo(0, 5);
  });
});
