import { Vector3, Quaternion } from "three";
import type { URDFRobot } from "urdf-loader";
import { solveIK } from "./ik";
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
  const box = new Vector3(...boxPos);
  const home = jointNames.map((n) => robot.joints[n]!.angle as number);
  const restore = () => jointNames.forEach((n, i) => robot.setJointValue(n, home[i]!));

  let best: GraspPlan | null = null;
  let bestCost = Infinity;
  for (const dir of candidates) {
    // EE z-axis points toward the box (= -approachDir)
    const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), dir.clone().negate());
    restore();
    solveIK(robot, eeLink, jointNames, boxPos, [quat.x, quat.y, quat.z, quat.w], { iterations: 40, lambda: 0.06 });
    robot.updateMatrixWorld(true);
    const reached = robot.links[eeLink]!.getWorldPosition(new Vector3());
    if (reached.distanceTo(box) > reach) continue;
    const cost = jointNames.reduce((s, n, i) => s + Math.abs((robot.joints[n]!.angle as number) - home[i]!), 0);
    if (cost < bestCost) {
      bestCost = cost;
      const pre = box.clone().add(dir.clone().multiplyScalar(approachDist));
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

/** Build approach→grasp→close→lift keyframes from a grasp plan. */
export function buildGraspTrajectory(plan: GraspPlan, liftHeight = 0.15): Keyframe[] {
  const q = plan.graspQuat;
  return [
    { t: 0, position: plan.prePos, quaternion: q, gripper: 0 },
    { t: 1, position: plan.graspPos, quaternion: q, gripper: 0 },
    { t: 1.5, position: plan.graspPos, quaternion: q, gripper: 1 },
    { t: 2.5, position: [plan.graspPos[0], plan.graspPos[1] + liftHeight, plan.graspPos[2]], quaternion: q, gripper: 1 },
  ];
}
