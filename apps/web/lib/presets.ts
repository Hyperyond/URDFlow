export interface RobotPreset {
  id: string;
  name: string;
  url: string;
}

export const PRESETS: RobotPreset[] = [
  { id: "panda", name: "Franka Panda", url: "/robots/panda/panda.urdf" },
];
