import { Quaternion, Vector3 } from "three";
import type { URDFRobot } from "urdf-loader";
import type { KinematicChain } from "./chains";

/** Planar pose of the robot's base on the ground: meters + yaw about world-Y. */
export interface BasePose {
  x: number;
  z: number;
  yaw: number;
}

const LEGGED = /(^|[ _])leg([ _]|$)|hip|knee|ankle/i;

/**
 * Can this robot reposition its base? True for legged robots (humanoids/quadrupeds)
 * and anything whose root joint is floating — false for bolted-down arms, which must
 * never "slide" toward an unreachable target.
 */
export function isMobileBase(robot: URDFRobot, chains: KinematicChain[]): boolean {
  const legChains = chains.filter(
    (c) => LEGGED.test(c.name) || c.joints.some((j) => LEGGED.test(j)),
  ).length;
  if (legChains >= 2) return true;
  return Object.values(robot.joints).some(
    (j) => (j as { jointType?: string }).jointType === "floating",
  );
}

const X_TO_Y_UP = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);

/**
 * Place the robot at a planar base pose, composing the yaw with the URDF Z-up → Y-up
 * conversion (which lives in the root quaternion). The vertical ground lift (owned by
 * the viewer's fit) is preserved.
 */
export function applyBasePose(robot: URDFRobot, pose: BasePose): void {
  const yawQ = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), pose.yaw);
  robot.quaternion.copy(yawQ.clone().multiply(X_TO_Y_UP));
  robot.position.x = pose.x;
  robot.position.z = pose.z;
  robot.updateMatrixWorld(true);
}

/** Heading of a planar vector under three.js' Y-rotation convention. */
const heading = (x: number, z: number) => Math.atan2(x, z);

/**
 * Where should the base stand so the hand's hover anchor lands exactly on `cube`?
 * Walk straight toward the cube and stop at the anchor's current standoff radius,
 * turning so the anchor's base-relative bearing points at the cube.
 */
export function computeApproachBase(
  base: BasePose,
  anchorWorld: [number, number],
  cube: [number, number],
): BasePose {
  // anchor offset in the base's own frame (un-rotate the current yaw)
  const ox = anchorWorld[0] - base.x;
  const oz = anchorWorld[1] - base.z;
  const c = Math.cos(-base.yaw);
  const s = Math.sin(-base.yaw);
  const lx = ox * c + oz * s;
  const lz = -ox * s + oz * c;
  const r = Math.hypot(lx, lz);

  // stand on the ray from the cube back toward where we are now
  let dx = cube[0] - base.x;
  let dz = cube[1] - base.z;
  const d = Math.hypot(dx, dz) || 1;
  dx /= d;
  dz /= d;
  const nx = cube[0] - dx * r;
  const nz = cube[1] - dz * r;
  const yaw = heading(dx * r, dz * r) - heading(lx, lz);
  return { x: nx, z: nz, yaw };
}

/** Axis-aligned rectangle on the ground the base must not glide through. */
export interface RectObstacle {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

function inside(p: [number, number], r: RectObstacle): boolean {
  return p[0] > r.minX && p[0] < r.maxX && p[1] > r.minZ && p[1] < r.maxZ;
}

/** Does the segment a→b pass through the rectangle? (Liang–Barsky clip test.) */
function segmentHitsRect(a: [number, number], b: [number, number], r: RectObstacle): boolean {
  const dx = b[0] - a[0];
  const dz = b[1] - a[1];
  let t0 = 0;
  let t1 = 1;
  const clip = (p: number, q: number): boolean => {
    if (Math.abs(p) < 1e-12) return q >= 0;
    const t = q / p;
    if (p < 0) {
      if (t > t1) return false;
      if (t > t0) t0 = t;
    } else {
      if (t < t0) return false;
      if (t < t1) t1 = t;
    }
    return true;
  };
  return (
    clip(-dx, a[0] - r.minX) &&
    clip(dx, r.maxX - a[0]) &&
    clip(-dz, a[1] - r.minZ) &&
    clip(dz, r.maxZ - a[1]) &&
    t1 > t0
  );
}

/**
 * Plan a base glide from→to that doesn't cut through any obstacle (e.g. the work
 * table): straight when clear, else around the blocking rectangle's corners. Returns
 * the waypoints to visit (destination included, start excluded). Falls back to the
 * straight line when no clear route exists — better to glide oddly than to freeze.
 */
export function planBasePath(
  from: [number, number],
  to: [number, number],
  obstacles: RectObstacle[],
  clearance = 0.3,
): [number, number][] {
  const inflated = obstacles.map((o) => ({
    minX: o.minX - clearance,
    maxX: o.maxX + clearance,
    minZ: o.minZ - clearance,
    maxZ: o.maxZ + clearance,
  }));
  const blocked = (a: [number, number], b: [number, number]) =>
    inflated.some((r) => !inside(a, r) && !inside(b, r) && segmentHitsRect(a, b, r));
  if (!blocked(from, to)) return [to];

  const hit = inflated.find((r) => segmentHitsRect(from, to, r));
  if (!hit || inside(from, hit) || inside(to, hit)) return [to]; // degenerate — give up

  const eps = 0.02;
  const corners: [number, number][] = [
    [hit.minX - eps, hit.minZ - eps],
    [hit.maxX + eps, hit.minZ - eps],
    [hit.minX - eps, hit.maxZ + eps],
    [hit.maxX + eps, hit.maxZ + eps],
  ];
  const len = (a: [number, number], b: [number, number]) => Math.hypot(a[0] - b[0], a[1] - b[1]);

  // one-corner detour first, then two adjacent corners, shortest clear route wins
  let best: [number, number][] | null = null;
  let bestLen = Infinity;
  for (const c of corners) {
    if (blocked(from, c) || blocked(c, to)) continue;
    const l = len(from, c) + len(c, to);
    if (l < bestLen) {
      bestLen = l;
      best = [c, to];
    }
  }
  if (!best) {
    for (const c1 of corners) {
      for (const c2 of corners) {
        if (c1 === c2) continue;
        if (blocked(from, c1) || blocked(c1, c2) || blocked(c2, to)) continue;
        const l = len(from, c1) + len(c1, c2) + len(c2, to);
        if (l < bestLen) {
          bestLen = l;
          best = [c1, c2, to];
        }
      }
    }
  }
  return best ?? [to];
}
