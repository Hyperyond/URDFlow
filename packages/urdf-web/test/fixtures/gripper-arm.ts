// A minimal arm with two prismatic finger joints, for gripper-detection tests.
export const gripperArmURDF = `<?xml version="1.0"?>
<robot name="gripper_arm">
  <link name="base"><visual><geometry><box size="0.1 0.1 0.1"/></geometry></visual></link>
  <link name="link1"><visual><geometry><box size="0.05 0.05 0.3"/></geometry></visual></link>
  <link name="finger1"><visual><geometry><box size="0.02 0.02 0.05"/></geometry></visual></link>
  <link name="finger2"><visual><geometry><box size="0.02 0.02 0.05"/></geometry></visual></link>
  <joint name="joint1" type="revolute">
    <parent link="base"/><child link="link1"/>
    <origin xyz="0 0 0.1" rpy="0 0 0"/><axis xyz="0 1 0"/>
    <limit lower="-3.14" upper="3.14" effort="1" velocity="1"/>
  </joint>
  <joint name="panda_finger_joint1" type="prismatic">
    <parent link="link1"/><child link="finger1"/>
    <origin xyz="0 0 0.3" rpy="0 0 0"/><axis xyz="1 0 0"/>
    <limit lower="0" upper="0.04" effort="1" velocity="1"/>
  </joint>
  <joint name="panda_finger_joint2" type="prismatic">
    <parent link="link1"/><child link="finger2"/>
    <origin xyz="0 0 0.3" rpy="0 0 0"/><axis xyz="-1 0 0"/>
    <limit lower="0" upper="0.04" effort="1" velocity="1"/>
  </joint>
</robot>`;
