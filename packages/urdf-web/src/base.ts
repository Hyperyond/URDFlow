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
