// A 3-DOF planar arm: 3 revolute joints about the same axis, so a 2D position
// target is redundant (3 DOF > 2) — exercises null-space rest-pose bias.
export const threeJointArmURDF = `<?xml version="1.0"?>
<robot name="three_joint_arm">
  <link name="base"/>
  <link name="l1"/>
  <link name="l2"/>
  <link name="l3"/>
  <link name="tip"/>
  <joint name="j1" type="revolute">
    <parent link="base"/><child link="l1"/>
    <origin xyz="0 0 0" rpy="0 0 0"/><axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14" effort="1" velocity="1"/>
  </joint>
  <joint name="j2" type="revolute">
    <parent link="l1"/><child link="l2"/>
    <origin xyz="0.3 0 0" rpy="0 0 0"/><axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14" effort="1" velocity="1"/>
  </joint>
  <joint name="j3" type="revolute">
    <parent link="l2"/><child link="l3"/>
    <origin xyz="0.3 0 0" rpy="0 0 0"/><axis xyz="0 0 1"/>
    <limit lower="-3.14" upper="3.14" effort="1" velocity="1"/>
  </joint>
  <joint name="jt" type="fixed">
    <parent link="l3"/><child link="tip"/>
    <origin xyz="0.3 0 0" rpy="0 0 0"/>
  </joint>
</robot>`;
