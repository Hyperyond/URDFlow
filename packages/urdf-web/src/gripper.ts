import type { URDFRobot } from "urdf-loader";

export interface GripperJoint {
  name: string;
  lower: number;
  upper: number;
  type: "prismatic" | "revolute";
}

const GRIPPER_RE = /finger|gripper|claw|hand|clamp|jaw/i;

const isJoint = (o: unknown): boolean => (o as { isURDFJoint?: boolean }).isURDFJoint === true;
const isLink = (o: unknown): boolean => (o as { isURDFLink?: boolean }).isURDFLink === true;

/**
 * Find the robot's own gripper joints. A movable joint counts when its own name says
 * gripper/finger/…, or — for leaf joints whose child link ends the chain (fingers always
 * do) — when its parent or child link name says so (PiPER names its fingers joint7/8 but
 * hangs them under gripper_base).
 */
export function findGripperJoints(robot: URDFRobot): GripperJoint[] {
  const out: GripperJoint[] = [];
  for (const [name, j] of Object.entries(robot.joints)) {
    const jt = (j as { jointType?: string }).jointType;
    if (jt !== "prismatic" && jt !== "revolute") continue;
    if (!GRIPPER_RE.test(name)) {
      const joint = j as unknown as { parent?: { name?: string }; children?: unknown[] };
      const childLink = (joint.children ?? []).find(isLink) as
        | { name?: string; children?: unknown[] }
        | undefined;
      const childIsLeaf = !!childLink && !(childLink.children ?? []).some(isJoint);
      const linkHit =
        childIsLeaf &&
        (GRIPPER_RE.test(joint.parent?.name ?? "") || GRIPPER_RE.test(childLink?.name ?? ""));
      if (!linkHit) continue;
    }
    const lim = (j as { limit?: { lower?: number; upper?: number } }).limit ?? {};
    out.push({
      name,
      lower: Number(lim.lower ?? 0),
      upper: Number(lim.upper ?? 0.04),
      type: jt,
    });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** Drive gripper joints: value 0 = open (upper limit), 1 = closed (lower limit). */
export function applyGripper(robot: URDFRobot, joints: GripperJoint[], value: number): void {
  for (const j of joints) robot.setJointValue(j.name, lerp(j.upper, j.lower, value));
}

/**
 * Closure value (0..1) that parks the jaws ~width apart, so the fingers stop AT the
 * object's faces instead of clipping through it. Prismatic parallel jaws close by their
 * summed travel; revolute jaws have unknown lever geometry, so fall back to a firm
 * partial close.
 */
export function closureForWidth(joints: GripperJoint[], width: number): number {
  if (joints.length === 0) return 1;
  if (joints.some((j) => j.type === "revolute")) return 0.8;
  const gap = joints.reduce((s, j) => s + Math.abs(j.upper - j.lower), 0);
  if (gap <= 1e-9) return 1;
  return Math.min(1, Math.max(0, 1 - width / gap));
}
