import type { URDFRobot } from "urdf-loader";

export interface GripperJoint {
  name: string;
  lower: number;
  upper: number;
}

const GRIPPER_RE = /finger|gripper|claw|hand/i;

/** Find the robot's own gripper joints (prismatic/revolute named finger/gripper/...). */
export function findGripperJoints(robot: URDFRobot): GripperJoint[] {
  const out: GripperJoint[] = [];
  for (const [name, j] of Object.entries(robot.joints)) {
    const jt = (j as { jointType?: string }).jointType;
    if (jt !== "prismatic" && jt !== "revolute") continue;
    if (!GRIPPER_RE.test(name)) continue;
    const lim = (j as { limit?: { lower?: number; upper?: number } }).limit ?? {};
    out.push({ name, lower: Number(lim.lower ?? 0), upper: Number(lim.upper ?? 0.04) });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** Drive gripper joints: value 0 = open (upper limit), 1 = closed (lower limit). */
export function applyGripper(robot: URDFRobot, joints: GripperJoint[], value: number): void {
  for (const j of joints) robot.setJointValue(j.name, lerp(j.upper, j.lower, value));
}
