import { Vector3, type Object3D } from "three";
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
 * partial close. Prefer calibrateGripper when meshes are available — it measures the
 * real jaw gap and is immune to axis-sign conventions.
 */
export function closureForWidth(joints: GripperJoint[], width: number): number {
  if (joints.length === 0) return 1;
  if (joints.some((j) => j.type === "revolute")) return 0.8;
  const gap = joints.reduce((s, j) => s + Math.abs(j.upper - j.lower), 0);
  if (gap <= 1e-9) return 1;
  return Math.min(1, Math.max(0, 1 - width / gap));
}

export interface GripperCalibration {
  /** Per-joint value at its own fully-open end (axis signs differ per joint!). */
  open: Record<string, number>;
  /** Per-joint value at its own fully-closed end. */
  closed: Record<string, number>;
  openGap: number;
  closedGap: number;
  /** Jaw gap (m) at the robot's current pose. */
  measureGap: () => number;
  /** u∈[0,1] along open→closed that parks the jaws ~width apart. */
  uForGap: (width: number) => number;
  /** Per-joint values at u along the calibrated open→closed sweep. */
  valuesAt: (u: number) => Record<string, number>;
  /** Bite point (gap midpoint at first pad contact) in the palm link's local frame. */
  tcp: [number, number, number];
  /** Palm link name the tcp is expressed in. */
  palmLink: string;
}

/** Subsampled local-space vertices of one mesh, paired with the mesh for FK transforms. */
interface CloudPart {
  obj: Object3D;
  verts: Float32Array; // xyz triplets in the mesh's local space
}

function collectCloud(root: Object3D, stopJoints: Set<Object3D>, budgetPerMesh = 160): CloudPart[] {
  const parts: CloudPart[] = [];
  const walk = (o: Object3D) => {
    if (stopJoints.has(o)) return;
    const mesh = o as {
      isMesh?: boolean;
      geometry?: { attributes?: { position?: { array: ArrayLike<number>; count: number } } };
    };
    if (mesh.isMesh && mesh.geometry?.attributes?.position) {
      const pos = mesh.geometry.attributes.position;
      const stride = Math.max(1, Math.floor(pos.count / budgetPerMesh));
      const n = Math.floor(pos.count / stride);
      const out = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) {
        const k = i * stride * 3;
        out[i * 3] = Number(pos.array[k]);
        out[i * 3 + 1] = Number(pos.array[k + 1]);
        out[i * 3 + 2] = Number(pos.array[k + 2]);
      }
      parts.push({ obj: o as Object3D, verts: out });
    }
    for (const c of o.children ?? []) walk(c);
  };
  walk(root);
  return parts;
}

/** World-space points of a cloud at the robot's current pose. */
function worldPoints(parts: CloudPart[]): Float32Array {
  let total = 0;
  for (const p of parts) total += p.verts.length / 3;
  const out = new Float32Array(total * 3);
  const v = new Vector3();
  let w = 0;
  for (const p of parts) {
    const m = p.obj.matrixWorld;
    for (let i = 0; i < p.verts.length; i += 3) {
      v.set(p.verts[i]!, p.verts[i + 1]!, p.verts[i + 2]!).applyMatrix4(m);
      out[w++] = v.x;
      out[w++] = v.y;
      out[w++] = v.z;
    }
  }
  return out;
}

function closestPair(a: Float32Array, b: Float32Array): { d: number; pa: Vector3; pb: Vector3 } {
  let best = Infinity;
  let ai = 0;
  let bi = 0;
  for (let i = 0; i < a.length; i += 3) {
    const ax = a[i]!;
    const ay = a[i + 1]!;
    const az = a[i + 2]!;
    for (let j = 0; j < b.length; j += 3) {
      const dx = ax - b[j]!;
      const dy = ay - b[j + 1]!;
      const dz = az - b[j + 2]!;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) {
        best = d2;
        ai = i;
        bi = j;
      }
    }
  }
  return {
    d: Math.sqrt(best),
    pa: new Vector3(a[ai]!, a[ai + 1]!, a[ai + 2]!),
    pb: new Vector3(b[bi]!, b[bi + 1]!, b[bi + 2]!),
  };
}

function centroid(pts: Float32Array): Vector3 {
  const c = new Vector3();
  const n = pts.length / 3;
  for (let i = 0; i < pts.length; i += 3) {
    c.x += pts[i]!;
    c.y += pts[i + 1]!;
    c.z += pts[i + 2]!;
  }
  return n > 0 ? c.divideScalar(n) : c;
}

function pick(pts: Float32Array, idx: number[]): Float32Array {
  const out = new Float32Array(idx.length * 3);
  idx.forEach((p, k) => {
    out[k * 3] = pts[p * 3]!;
    out[k * 3 + 1] = pts[p * 3 + 1]!;
    out[k * 3 + 2] = pts[p * 3 + 2]!;
  });
  return out;
}

/**
 * Measure how the jaw aperture responds to closing by driving the joints through their
 * range with forward kinematics on the real finger meshes. Each joint's open end is
 * probed independently (exporters flip axis signs joint by joint — PiPER's two fingers
 * disagree), and the aperture is the closest distance between the gripping pads: the
 * surface regions whose mutual distance shrinks while closing and ends small. Slider
 * mounts and hinge roots sit close the whole sweep, scissor flanks only meet past
 * over-close — the travel score rejects both. Returns null when there is nothing
 * measurable (no meshes, or the jaws barely move).
 */
export function calibrateGripper(
  robot: URDFRobot,
  joints: GripperJoint[],
  samples = 9,
): GripperCalibration | null {
  if (joints.length === 0) return null;
  const jointObjs = joints
    .map((g) => robot.joints[g.name])
    .filter(Boolean) as unknown as Object3D[];
  const stop = new Set(jointObjs);
  const fingers = jointObjs
    .map((j) => (j.children ?? []).find((c) => (c as { isURDFLink?: boolean }).isURDFLink))
    .filter(Boolean) as Object3D[];
  if (fingers.length === 0) return null;
  const palm = jointObjs[0]!.parent as Object3D | null;
  if (!palm) return null;
  const palmName = Object.entries(robot.links).find(([, l]) => (l as unknown) === palm)?.[0];
  if (!palmName) return null;

  // side A = first finger; side B = second finger, or the palm minus the gripper
  // subtrees for single-jaw grippers (SO-100's fixed jaw lives on the palm)
  const cloudA = collectCloud(fingers[0]!, new Set());
  const cloudB = fingers.length > 1 ? collectCloud(fingers[1]!, new Set()) : collectCloud(palm, stop);
  if (cloudA.length === 0 || cloudB.length === 0) return null;

  const original = joints.map((g) => robot.joints[g.name]!.angle as number);
  const restore = () => joints.forEach((g, i) => robot.setJointValue(g.name, original[i]!));
  const ptsA = () => worldPoints(cloudA);
  const ptsB = () => worldPoints(cloudB);

  // per-joint open end: the end that moves the two sides' centroids apart
  const open: Record<string, number> = {};
  const closed: Record<string, number> = {};
  const mid = (g: GripperJoint) => (g.lower + g.upper) / 2;
  const centroidDist = (): number => {
    robot.updateMatrixWorld(true);
    return centroid(ptsA()).distanceTo(centroid(ptsB()));
  };
  for (const g of joints) {
    joints.forEach((o) => robot.setJointValue(o.name, mid(o)));
    robot.setJointValue(g.name, g.upper);
    const dUpper = centroidDist();
    joints.forEach((o) => robot.setJointValue(o.name, mid(o)));
    robot.setJointValue(g.name, g.lower);
    const dLower = centroidDist();
    open[g.name] = dUpper >= dLower ? g.upper : g.lower;
    closed[g.name] = dUpper >= dLower ? g.lower : g.upper;
  }

  const valuesAt = (u: number): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const g of joints) out[g.name] = open[g.name]! + (closed[g.name]! - open[g.name]!) * u;
    return out;
  };
  const setU = (u: number) => {
    const v = valuesAt(u);
    for (const g of joints) robot.setJointValue(g.name, v[g.name]!);
  };

  // identify the gripping pads: surface points whose distance to the other side
  // SHRINKS a lot while closing and ends up small
  setU(0);
  robot.updateMatrixWorld(true);
  const A0 = ptsA();
  const B0 = ptsB();
  setU(1);
  robot.updateMatrixWorld(true);
  const A1 = ptsA();
  const B1 = ptsB();
  const minTo = (x: number, y: number, z: number, other: Float32Array): number => {
    let best = Infinity;
    for (let j = 0; j < other.length; j += 3) {
      const dx = x - other[j]!;
      const dy = y - other[j + 1]!;
      const dz = z - other[j + 2]!;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < best) best = d2;
    }
    return Math.sqrt(best);
  };
  const scorePads = (
    open0: Float32Array,
    openOther: Float32Array,
    closed0: Float32Array,
    closedOther: Float32Array,
  ): number[] => {
    const idx: number[] = [];
    const scores: number[] = [];
    for (let i = 0; i < open0.length; i += 3) {
      const dOpen = minTo(open0[i]!, open0[i + 1]!, open0[i + 2]!, openOther);
      const dClosed = minTo(closed0[i]!, closed0[i + 1]!, closed0[i + 2]!, closedOther);
      scores.push(dOpen - dClosed);
      if (dClosed <= 0.008) idx.push(i / 3);
    }
    const maxScore = Math.max(...scores, 0);
    return idx.filter((k) => scores[k]! >= Math.max(0.004, 0.4 * maxScore));
  };
  const padIdxA = scorePads(A0, B0, A1, B1);
  const padIdxB = scorePads(B0, A0, B1, A1);
  if (padIdxA.length === 0 || padIdxB.length === 0) {
    restore();
    return null;
  }
  const padGap = (): number => {
    robot.updateMatrixWorld(true);
    return closestPair(pick(ptsA(), padIdxA), pick(ptsB(), padIdxB)).d;
  };

  const us: number[] = [];
  const gaps: number[] = [];
  for (let i = 0; i < samples; i++) {
    const u = i / (samples - 1);
    setU(u);
    us.push(u);
    gaps.push(padGap());
  }
  const openGap = gaps[0]!;
  const closedGap = gaps[gaps.length - 1]!;
  if (openGap - closedGap < 5e-3) {
    restore();
    return null;
  }

  // bite point: midpoint of the pad pair at first pad contact (else the closed end)
  let uBite = 1;
  for (let i = 0; i < gaps.length; i++) {
    if (gaps[i]! <= 2e-3) {
      uBite = us[i]!;
      break;
    }
  }
  setU(uBite);
  robot.updateMatrixWorld(true);
  const bite = closestPair(pick(ptsA(), padIdxA), pick(ptsB(), padIdxB));
  const midPt = bite.pa.clone().add(bite.pb).multiplyScalar(0.5);
  const tcpLocal = palm.worldToLocal(midPt.clone());

  const uForGap = (width: number): number => {
    for (let i = 0; i < gaps.length - 1; i++) {
      const g1 = gaps[i]!;
      const g2 = gaps[i + 1]!;
      if (g2 <= width) {
        const t = g1 === g2 ? 0 : (g1 - width) / (g1 - g2);
        return us[i]! + (us[i + 1]! - us[i]!) * Math.max(0, Math.min(1, t));
      }
    }
    return 1;
  };

  restore();
  return {
    open,
    closed,
    openGap,
    closedGap,
    measureGap: padGap,
    uForGap,
    valuesAt,
    tcp: [tcpLocal.x, tcpLocal.y, tcpLocal.z],
    palmLink: palmName,
  };
}

/**
 * Drive a calibrated gripper: signal 0 = fully open, 1 = closed onto an object of
 * `width` — the jaws stop at its faces, whatever the joint axis conventions are.
 */
export function applyGripperCalibrated(
  robot: URDFRobot,
  calib: GripperCalibration,
  signal: number,
  width: number,
): void {
  const u = calib.uForGap(width) * Math.max(0, Math.min(1, signal));
  const v = calib.valuesAt(u);
  for (const [name, value] of Object.entries(v)) robot.setJointValue(name, value);
}
