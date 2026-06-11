export interface RobotPreset {
  id: string;
  name: string;
  url: string;
  /**
   * Natural "ready" joint pose applied after load (radians/meters by joint name).
   * Joints not listed fall back to the generic naturalRestPose heuristic.
   */
  readyPose?: Record<string, number>;
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
  },
  {
    id: "g1",
    name: "Unitree G1 (人形+夹爪)",
    url: "/robots/g1/g1.urdf",
    // both arms in a table-work pose — auto hand selection may pick either one
    readyPose: {
      left_shoulder_pitch_joint: -0.4,
      left_shoulder_roll_joint: 0.25,
      left_elbow_joint: 0.9,
      right_shoulder_pitch_joint: -0.4,
      right_shoulder_roll_joint: -0.25,
      right_elbow_joint: 0.9,
    },
  },
  {
    id: "h1",
    name: "Unitree H1 (人形)",
    url: "/robots/h1/h1.urdf",
    readyPose: {
      left_shoulder_pitch_joint: -0.3,
      left_elbow_joint: 0.6,
      right_shoulder_pitch_joint: -0.3,
      right_elbow_joint: 0.6,
    },
  },
];
