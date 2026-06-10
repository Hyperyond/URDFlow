import type { URDFRobot } from "urdf-loader";
import { solveIK, type SolveIKOptions } from "./ik";
import type { EEPoseSample } from "./trajectory";

export interface JointFrame {
  t: number;
  joints: Record<string, number>;
  gripper: number;
}
export interface LeRobotFrame {
  "observation.state": number[];
  action: number[];
  timestamp: number;
  frame_index: number;
  episode_index: number;
}

/** Retarget an EE pose trajectory to joint frames via per-sample IK (warm-started by shared robot state). */
export function retargetTrajectory(
  robot: URDFRobot,
  eeLink: string,
  jointNames: string[],
  samples: EEPoseSample[],
  opts: SolveIKOptions = {},
): JointFrame[] {
  return samples.map((s) => {
    const joints = solveIK(robot, eeLink, jointNames, s.position, s.quaternion, opts);
    return { t: s.t, joints: { ...joints }, gripper: s.gripper };
  });
}

/** Serialize joint frames to LeRobot-style frames (state = joints+gripper; action = next frame's state). */
export function toLeRobotFrames(
  jointFrames: JointFrame[],
  jointNames: string[],
  episodeIndex: number,
): LeRobotFrame[] {
  const state = (f: JointFrame) => [...jointNames.map((n) => f.joints[n] ?? 0), f.gripper];
  return jointFrames.map((f, i) => ({
    "observation.state": state(f),
    action: state(jointFrames[Math.min(i + 1, jointFrames.length - 1)]!),
    timestamp: f.t,
    frame_index: i,
    episode_index: episodeIndex,
  }));
}
