import { Vector3, Quaternion } from "three";
import type { URDFRobot } from "urdf-loader";
import { dampedLeastSquares } from "./ik-math";

/** Leaf link of the kinematic tree (first link with no child joint). */
export function findEndEffectorLink(robot: URDFRobot): string {
  for (const [name, link] of Object.entries(robot.links)) {
    const hasChildJoint = (link.children ?? []).some(
      (c: unknown) => (c as { isURDFJoint?: boolean }).isURDFJoint === true,
    );
    if (!hasChildJoint) return name;
  }
  return Object.keys(robot.links).pop()!;
}

function eePose(robot: URDFRobot, eeLink: string): { pos: Vector3; quat: Quaternion } {
  robot.updateMatrixWorld(true);
  const link = robot.links[eeLink]!;
  return {
    pos: link.getWorldPosition(new Vector3()),
    quat: link.getWorldQuaternion(new Quaternion()),
  };
}

/** Orientation error as a rotation vector (axis*angle), world frame. */
function orientationError(current: Quaternion, target: Quaternion): [number, number, number] {
  const dq = target.clone().multiply(current.clone().invert());
  if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w); // shortest path
  const angle = 2 * Math.acos(Math.min(1, Math.abs(dq.w)));
  const s = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
  if (s < 1e-6 || angle < 1e-6) return [0, 0, 0];
  return [(dq.x / s) * angle, (dq.y / s) * angle, (dq.z / s) * angle];
}

/** 6×n numeric Jacobian via finite differences over joint values. */
export function numericJacobian(
  robot: URDFRobot,
  eeLink: string,
  jointNames: string[],
  delta = 1e-4,
): number[][] {
  const base = eePose(robot, eeLink);
  const cols: number[][] = [];
  for (const name of jointNames) {
    const q0 = robot.joints[name]!.angle as number;
    robot.setJointValue(name, q0 + delta);
    const p = eePose(robot, eeLink);
    robot.setJointValue(name, q0);
    const dp = p.pos.clone().sub(base.pos).divideScalar(delta);
    const dr = orientationError(base.quat, p.quat).map((x) => x / delta);
    cols.push([dp.x, dp.y, dp.z, dr[0]!, dr[1]!, dr[2]!]);
  }
  const J: number[][] = Array.from({ length: 6 }, () => new Array<number>(jointNames.length).fill(0));
  for (let c = 0; c < cols.length; c++) for (let r = 0; r < 6; r++) J[r]![c] = cols[c]![r]!;
  return J;
}

export interface SolveIKOptions {
  iterations?: number;
  lambda?: number;
  limits?: Record<string, { lower: number; upper: number }>;
}

/** Iteratively drive joints so eeLink reaches target (mutates robot). Returns joint angles. */
export function solveIK(
  robot: URDFRobot,
  eeLink: string,
  jointNames: string[],
  targetPos: [number, number, number],
  targetQuat: [number, number, number, number],
  opts: SolveIKOptions = {},
): Record<string, number> {
  const iterations = opts.iterations ?? 40;
  const lambda = opts.lambda ?? 0.05;
  const tQuat = new Quaternion(...targetQuat);
  const tPos = new Vector3(...targetPos);
  for (let it = 0; it < iterations; it++) {
    const cur = eePose(robot, eeLink);
    const posErr = tPos.clone().sub(cur.pos);
    const rotErr = orientationError(cur.quat, tQuat);
    const dx = [posErr.x, posErr.y, posErr.z, rotErr[0]!, rotErr[1]!, rotErr[2]!];
    if (Math.hypot(...dx) < 1e-4) break;
    const J = numericJacobian(robot, eeLink, jointNames);
    const dq = dampedLeastSquares(J, dx, lambda);
    for (let i = 0; i < jointNames.length; i++) {
      const name = jointNames[i]!;
      let q = (robot.joints[name]!.angle as number) + dq[i]!;
      const lim = opts.limits?.[name];
      if (lim) q = Math.max(lim.lower, Math.min(lim.upper, q));
      robot.setJointValue(name, q);
    }
  }
  const out: Record<string, number> = {};
  for (const name of jointNames) out[name] = robot.joints[name]!.angle as number;
  return out;
}
