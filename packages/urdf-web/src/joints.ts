import type { URDFRobot } from "urdf-loader";
import type { JointInfo, URDFJointType } from "./types";

const MOVABLE: ReadonlySet<URDFJointType> = new Set([
  "revolute",
  "continuous",
  "prismatic",
]);

/** Flatten a robot's movable joints into UI-friendly descriptors. */
export function getJointModel(robot: URDFRobot): JointInfo[] {
  return Object.values(robot.joints)
    .filter((j) => MOVABLE.has(j.jointType as URDFJointType))
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((j) => {
      const lower = j.limit?.lower ?? 0;
      const upper = j.limit?.upper ?? 0;
      const unlimited = j.jointType === "continuous" || lower === upper;
      return {
        name: j.name,
        type: j.jointType as URDFJointType,
        lower: unlimited ? -Math.PI : Number(lower),
        upper: unlimited ? Math.PI : Number(upper),
      };
    });
}

/** Set one joint's value (radians or meters). Returns true if it changed. */
export function setJoint(
  robot: URDFRobot,
  name: string,
  value: number,
): boolean {
  return robot.setJointValue(name, value);
}
