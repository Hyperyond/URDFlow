import { Vector3, Quaternion } from "three";
import type { URDFRobot } from "urdf-loader";
import { solveIK, toolWorldPosition } from "./ik";
import type { Keyframe } from "./trajectory";

export interface GraspPlan {
  approachDir: [number, number, number];
  graspPos: [number, number, number];
  graspQuat: [number, number, number, number];
  prePos: [number, number, number];
}
export interface PlanGraspOptions {
  candidates?: number;
  approachDist?: number;
  reachThreshold?: number;
  /** Bias toward approaching from above (top-down). Higher = stronger preference. */
  approachWeight?: number;
  /** TCP in eeLink's local frame — IK drives this grasp point, not the link origin. */
  tcpOffset?: [number, number, number];
  /** Gripper approach axis in eeLink's local frame (default +Z). */
  toolAxis?: [number, number, number];
  /** Reject approach directions lower than this (1 = straight down only, 0 = horizon). */
  minApproachY?: number;
  /** Keep the pre-grasp waypoint at least this high above the ground plane. */
  clearance?: number;
  /** Joint-space pose used for the IK null-space bias and the cost reference. */
  restPose?: number[];
  /** Orientation-error weight; defaults to 0.3 for under-actuated arms (< 6 joints), else 1. */
  rotWeight?: number;
  /** Lift waypoint height validated per candidate, so the whole pick stays trackable. */
  liftCheckHeight?: number;
  /** Finger-separation direction (eeLink-local). Grasps keeping it horizontal score better. */
  openAxis?: [number, number, number];
}

/** Roughly uniform points on a unit sphere (Fibonacci spiral). */
function fibonacciSphere(n: number): Vector3[] {
  const pts: Vector3[] = [];
  const phi = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = phi * i;
    pts.push(new Vector3(Math.cos(th) * r, y, Math.sin(th) * r));
  }
  return pts;
}

/** Pick a reachable, low-cost grasp pose for a box at boxPos. Returns null if unreachable. */
export function planGrasp(
  robot: URDFRobot,
  eeLink: string,
  jointNames: string[],
  boxPos: [number, number, number],
  opts: PlanGraspOptions = {},
): GraspPlan | null {
  const candidates = fibonacciSphere(opts.candidates ?? 24);
  const approachDist = opts.approachDist ?? 0.1;
  const reach = opts.reachThreshold ?? 0.03;
  const minY = opts.minApproachY ?? 0.15;
  const clearance = opts.clearance ?? 0.02;
  // a 5-DOF arm can't hit a full 6D pose — relax orientation so position converges
  const rotWeight = opts.rotWeight ?? (jointNames.length < 6 ? 0.3 : 1);
  const toolAxis = new Vector3(...(opts.toolAxis ?? [0, 0, 1])).normalize();
  const box = new Vector3(...boxPos);
  const home = jointNames.map((n) => robot.joints[n]!.angle as number);
  const rest = opts.restPose ?? home;
  const restore = () => jointNames.forEach((n, i) => robot.setJointValue(n, home[i]!));

  let best: GraspPlan | null = null;
  let bestCost = Infinity;
  const liftH = opts.liftCheckHeight ?? 0.15;
  const ikOpts = {
    iterations: 40,
    lambda: 0.06,
    restPose: rest,
    restGain: 0.03,
    tcpOffset: opts.tcpOffset,
    rotWeight,
    // guard relative to the object's own height — table-top scenes and robots whose
    // base frame isn't at ground level (humanoid pelvises) keep working
    floorY: box.y - clearance * 0.5,
  };
  for (const dir of candidates) {
    // approaching from below the horizon means coming through the floor — never valid
    if (dir.y < minY) continue;
    // the gripper's approach axis points toward the box (= -approachDir); the twist
    // around it is free for a box grasp, so try two — wrist-limit walls (e.g. PiPER's
    // joint6) often block one twist but not the other
    const base = new Quaternion().setFromUnitVectors(toolAxis, dir.clone().negate());
    for (const twist of [0, Math.PI / 2]) {
      const quat = base
        .clone()
        .multiply(new Quaternion().setFromAxisAngle(toolAxis, twist));
      restore();
      solveIK(robot, eeLink, jointNames, boxPos, [quat.x, quat.y, quat.z, quat.w], ikOpts);
      const reached = toolWorldPosition(robot, eeLink, opts.tcpOffset);
      if (reached.distanceTo(box) > reach) continue;
      const jointCost = jointNames.reduce(
        (s, n, i) => s + Math.abs((robot.joints[n]!.angle as number) - rest[i]!),
        0,
      );
      // prefer approaching from above so the gripper comes down onto the object
      const topDown = (opts.approachWeight ?? 2.5) * (1 - dir.y);
      // and prefer directions the arm can actually align its tool axis with
      const achievedAxis = toolAxis
        .clone()
        .applyQuaternion(robot.links[eeLink]!.getWorldQuaternion(new Quaternion()));
      const align = achievedAxis.angleTo(dir.clone().negate());
      // keep the finger plane horizontal: if the pads separate vertically, a finger
      // stabs down through the object instead of straddling it
      let openCost = 0;
      if (opts.openAxis) {
        const w = new Vector3(...opts.openAxis).applyQuaternion(
          robot.links[eeLink]!.getWorldQuaternion(new Quaternion()),
        );
        openCost = Math.abs(w.y) * 2.0;
      }
      // configurations that park a joint on its limit have no margin left to track
      // the carry — penalize them so a roomier twist/direction wins
      const limitCost = jointNames.reduce((s, n) => {
        const j = robot.joints[n] as unknown as {
          angle: number;
          jointType?: string;
          limit?: { lower?: number; upper?: number };
        };
        if (j.jointType === "continuous") return s;
        const lo = Number(j.limit?.lower ?? 0);
        const up = Number(j.limit?.upper ?? 0);
        if (!(up > lo)) return s;
        const margin = Math.min(j.angle - lo, up - j.angle) / (up - lo); // 0 at a limit
        return s + Math.max(0, 0.15 - margin) * 8;
      }, 0);
      const cost = jointCost + topDown + align * 1.5 + limitCost + openCost;
      if (cost >= bestCost) continue;
      // the lift waypoint must track too, or playback stalls against a joint limit
      if (liftH > 0) {
        const liftTarget: [number, number, number] = [box.x, box.y + liftH, box.z];
        solveIK(robot, eeLink, jointNames, liftTarget, [quat.x, quat.y, quat.z, quat.w], ikOpts);
        const lifted = toolWorldPosition(robot, eeLink, opts.tcpOffset);
        if (lifted.distanceTo(new Vector3(...liftTarget)) > reach) continue;
      }
      bestCost = cost;
      const pre = box.clone().add(dir.clone().multiplyScalar(approachDist));
      pre.y = Math.max(pre.y, clearance);
      best = {
        approachDir: [dir.x, dir.y, dir.z],
        graspPos: [box.x, box.y, box.z],
        graspQuat: [quat.x, quat.y, quat.z, quat.w],
        prePos: [pre.x, pre.y, pre.z],
      };
    }
  }
  restore();
  return best;
}

export interface GraspTrajectoryOptions {
  /** Start pose (current EE) so playback eases in instead of jumping to pre-grasp. */
  homePos?: [number, number, number];
  homeQuat?: [number, number, number, number];
  liftHeight?: number;
}

/**
 * Carry orientation for a place at `to`: the grasp orientation swung around world-Y by
 * the base-azimuth change from `from` to `to`. Keeping the world twist fixed through an
 * azimuth swing forces the wrist roll to counter-rotate — straight into its limit on
 * arms like PiPER; a box grasp doesn't care about twist, so let it follow the swing.
 */
export function carryQuat(
  graspQuat: [number, number, number, number],
  from: [number, number, number],
  to: [number, number, number],
): [number, number, number, number] {
  const a0 = Math.atan2(from[2], from[0]);
  const a1 = Math.atan2(to[2], to[0]);
  // rotating +azimuth in XZ = rotating by -angle about +Y (atan2(z,x) grows clockwise seen from +Y)
  const swing = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -(a1 - a0));
  const q = swing.multiply(new Quaternion(...graspQuat));
  return [q.x, q.y, q.z, q.w];
}

/** Build (home →) approach → grasp → close → lift keyframes from a grasp plan. */
export function buildGraspTrajectory(plan: GraspPlan, opts: GraspTrajectoryOptions = {}): Keyframe[] {
  const liftH = opts.liftHeight ?? 0.15;
  const q = plan.graspQuat;
  const kfs: Keyframe[] = [];
  let t = 0;
  if (opts.homePos) {
    kfs.push({ t: 0, position: opts.homePos, quaternion: opts.homeQuat ?? q, gripper: 0 });
    t = 1.5; // ease from home to pre-grasp over 1.5s
  }
  kfs.push({ t, position: plan.prePos, quaternion: q, gripper: 0 }); // pre-grasp, open
  kfs.push({ t: t + 1.5, position: plan.graspPos, quaternion: q, gripper: 0 }); // descend, still open
  kfs.push({ t: t + 2.3, position: plan.graspPos, quaternion: q, gripper: 1 }); // close gripper
  kfs.push({
    t: t + 3.8,
    position: [plan.graspPos[0], plan.graspPos[1] + liftH, plan.graspPos[2]],
    quaternion: q,
    gripper: 1,
  }); // lift
  return kfs;
}
