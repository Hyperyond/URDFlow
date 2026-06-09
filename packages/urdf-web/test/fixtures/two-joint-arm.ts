// Test fixture. The app serves an equivalent copy at
// apps/web/public/robots/two-joint-arm.urdf — keep the two in sync if either changes.
export const twoJointArmURDF = `<?xml version="1.0"?>
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
