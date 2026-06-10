export interface RobotPreset {
  id: string;
  name: string;
  url: string;
}

export const PRESETS: RobotPreset[] = [
  { id: "panda", name: "Franka Panda", url: "/robots/panda/panda.urdf" },
  { id: "so101", name: "SO-101 (gripper)", url: "/robots/so101_gripper/so101_gripper.urdf" },
];
