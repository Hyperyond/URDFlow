/** A per-link material override: the first rule whose `match` hits a mesh's owning
 *  link name (or the mesh name) wins. End the list with a catch-all regex as the default. */
export interface MaterialRule {
  match: RegExp;
  color: string;
  metalness?: number;
  roughness?: number;
}

export interface RobotPreset {
  id: string;
  name: string;
  url: string;
  /**
   * Natural "ready" joint pose applied after load (radians/meters by joint name).
   * Joints not listed fall back to the generic naturalRestPose heuristic.
   */
  readyPose?: Record<string, number>;
  /**
   * Optional realistic material scheme. STL-only URDFs (e.g. PiPER) otherwise render
   * as a flat, untextured "white model" — these rules paint a believable finish.
   */
  materials?: MaterialRule[];
}

export const PRESETS: RobotPreset[] = [
  {
    id: "panda",
    name: "Franka Panda",
    url: "/robots/panda/panda.urdf",
    // classic Franka ready pose: elbow bent, hand over the table pointing down
    readyPose: {
      panda_joint1: 0,
      panda_joint2: -0.785,
      panda_joint3: 0,
      panda_joint4: -2.356,
      panda_joint5: 0,
      panda_joint6: 1.571,
      panda_joint7: 0.785,
    },
  },
  {
    id: "so101",
    name: "SO-101 (gripper)",
    url: "/robots/so101_gripper/so101_gripper.urdf",
    readyPose: {
      base_link_to_link1: 0,
      link1_to_link2: -0.5,
      link2_to_link3: 1.0,
      link3_to_link4: 0.6,
      link4_to_link5: 0,
    },
  },
  {
    id: "so100",
    name: "SO-100 (jaw)",
    url: "/robots/so100/so100.urdf",
    readyPose: {
      shoulder_pan: 0,
      shoulder_lift: 0.6,
      elbow_flex: -1.1,
      wrist_flex: -0.5,
    },
  },
  {
    id: "piper",
    name: "AgileX PiPER",
    url: "/robots/piper/piper.urdf",
    readyPose: {
      joint1: 0,
      joint2: 1.0,
      joint3: -0.9,
      joint4: 0,
      joint5: 0.7,
      joint6: 0,
    },
    // Real PiPER: clean white body, dark machined joint caps, black gripper fingers.
    materials: [
      { match: /(gripper|link7|link8|finger)/i, color: "#26262b", metalness: 0.55, roughness: 0.42 },
      { match: /(link[2456])/i, color: "#c9ccd2", metalness: 0.45, roughness: 0.4 },
      { match: /.*/, color: "#edeff2", metalness: 0.25, roughness: 0.5 },
    ],
  },
];
