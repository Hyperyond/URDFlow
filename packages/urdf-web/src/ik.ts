import { Vector3, Quaternion } from "three";
import type { URDFRobot } from "urdf-loader";
import { dampedLeastSquares, dampedPinv, matmul, matvec } from "./ik-math";

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

/** World position of a point given in eeLink's local frame (the TCP). */
export function toolWorldPosition(
  robot: URDFRobot,
  eeLink: string,
  offset?: [number, number, number],
): Vector3 {
  robot.updateMatrixWorld(true);
  const link = robot.links[eeLink]!;
  if (!offset || (offset[0] === 0 && offset[1] === 0 && offset[2] === 0)) {
    return link.getWorldPosition(new Vector3());
  }
  return link.localToWorld(new Vector3(...offset));
}

function eePose(
  robot: URDFRobot,
  eeLink: string,
  tcpOffset?: [number, number, number],
): { pos: Vector3; quat: Quaternion } {
  return {
    pos: toolWorldPosition(robot, eeLink, tcpOffset),
    quat: robot.links[eeLink]!.getWorldQuaternion(new Quaternion()),
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

/**
 * 6×n numeric Jacobian via finite differences over joint values.
 * Probes backward when a joint sits on a limit (urdf-loader clamps the forward probe).
 */
export function numericJacobian(
  robot: URDFRobot,
  eeLink: string,
  jointNames: string[],
  delta = 1e-4,
  tcpOffset?: [number, number, number],
): number[][] {
  const base = eePose(robot, eeLink, tcpOffset);
  const cols: number[][] = [];
  for (const name of jointNames) {
    const joint = robot.joints[name]!;
    const q0 = joint.angle as number;
    robot.setJointValue(name, q0 + delta);
    let eff = (joint.angle as number) - q0;
    if (Math.abs(eff) < delta * 0.5) {
      // clamped at a limit — probe the other way so the column isn't zero
      robot.setJointValue(name, q0 - delta);
      eff = (joint.angle as number) - q0;
    }
    if (Math.abs(eff) < 1e-12) {
      robot.setJointValue(name, q0);
      cols.push([0, 0, 0, 0, 0, 0]);
      continue;
    }
    const p = eePose(robot, eeLink, tcpOffset);
    robot.setJointValue(name, q0);
    const dp = p.pos.clone().sub(base.pos).divideScalar(eff);
    const dr = orientationError(base.quat, p.quat).map((x) => x / eff);
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
  /** Secondary joint-space target; null-space biases toward it (natural posture). */
  restPose?: number[];
  restGain?: number;
  /** Tool center point in eeLink's local frame; IK drives this point instead of the link origin. */
  tcpOffset?: [number, number, number];
  /** Per-iteration cap on the largest joint step (rad / m) — keeps steps stable near singularities. */
  maxStep?: number;
  /**
   * Weight on the orientation error rows (default 1). Under-actuated arms (< 6 joints)
   * can't meet a full 6D pose — weight orientation down so position still converges.
   */
  rotWeight?: number;
  /** World-Y floor for the TCP: the error gets an upward boost whenever the tool dips below. */
  floorY?: number;
}

/**
 * Joint-space "ready" pose: 0 where legal, the limit midpoint where 0 is outside
 * the limits (e.g. Panda's elbow), nudged inward when 0 sits exactly on a limit.
 */
export function naturalRestPose(robot: URDFRobot, jointNames: string[]): number[] {
  return jointNames.map((name) => {
    const j = robot.joints[name]!;
    const type = (j as { jointType?: string }).jointType;
    const lim = (j as { limit?: { lower?: number; upper?: number } }).limit ?? {};
    const lower = Number(lim.lower ?? 0);
    const upper = Number(lim.upper ?? 0);
    if (type === "continuous" || !(upper > lower)) return 0;
    if (lower > 0 || upper < 0) return (lower + upper) / 2;
    const margin = 0.05 * (upper - lower);
    return Math.min(Math.max(0, lower + margin), upper - margin);
  });
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
  const maxStep = opts.maxStep ?? 0.35;
  const rotW = opts.rotWeight ?? 1;
  const tQuat = new Quaternion(...targetQuat);
  const tPos = new Vector3(...targetPos);
  for (let it = 0; it < iterations; it++) {
    const cur = eePose(robot, eeLink, opts.tcpOffset);
    const posErr = tPos.clone().sub(cur.pos);
    const rotErr = orientationError(cur.quat, tQuat);
    // under-actuated arms (rotWeight < 1): orientation yields to position as the tool
    // homes in, so the grasp point converges exactly instead of settling cm away
    const rw = rotW < 1 ? rotW * Math.min(1, posErr.length() / 0.1) : rotW;
    const dx = [posErr.x, posErr.y, posErr.z, rotErr[0]! * rw, rotErr[1]! * rw, rotErr[2]! * rw];
    if (opts.floorY !== undefined && cur.pos.y < opts.floorY) {
      dx[1] = Math.max(dx[1]!, opts.floorY - cur.pos.y); // climb out of the floor first
    }
    if (Math.hypot(...dx) < 1e-4) break;
    const J = numericJacobian(robot, eeLink, jointNames, 1e-4, opts.tcpOffset);
    if (rw !== 1) {
      // weighted least squares: scale the orientation rows to match the weighted error
      for (let r = 3; r < 6; r++) for (let c = 0; c < J[r]!.length; c++) J[r]![c] = J[r]![c]! * rw;
    }
    let dq: number[];
    if (opts.restPose && opts.restGain) {
      // primary task + null-space bias toward restPose: dq = J⁺dx + (I − J⁺J)·gain·(rest − q)
      const Jp = dampedPinv(J, lambda); // n×6
      const primary = matvec(Jp, dx);
      const JpJ = matmul(Jp, J); // n×n
      const rest = jointNames.map((name, i) => {
        const q = robot.joints[name]!.angle as number;
        return opts.restGain! * ((opts.restPose![i] ?? q) - q);
      });
      const JpJr = matvec(JpJ, rest); // P·rest = rest − J⁺J·rest
      dq = primary.map((p, i) => p + (rest[i]! - JpJr[i]!));
    } else {
      dq = dampedLeastSquares(J, dx, lambda);
    }
    let peak = 0;
    for (const v of dq) peak = Math.max(peak, Math.abs(v));
    if (peak > maxStep) {
      const s = maxStep / peak;
      dq = dq.map((v) => v * s);
    }
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
