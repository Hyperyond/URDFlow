export interface RobotPreset {
  id: string;
  name: string;
  url: string;
}

export const PRESETS: RobotPreset[] = [
  { id: "ur5", name: "UR5", url: "/robots/ur5/ur5.urdf" },
  { id: "panda", name: "Franka Panda", url: "/robots/panda/panda.urdf" },
];
