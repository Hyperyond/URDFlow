import { Box3, Matrix4, Vector3, type Object3D } from "three";
import type { URDFRobot } from "urdf-loader";
import { findGripperJoints, type GripperJoint } from "./gripper";
import { findEndEffectorLink } from "./ik";

export interface ToolFrame {
  /** Link whose frame IK drives (the palm for jaw grippers — never a moving finger). */
  link: string;
  /** Grasp center (TCP) in that link's local frame. */
  offset: [number, number, number];
  /** Approach axis in that link's local frame: points from the palm out between the fingertips. */
  axis: [number, number, number];
}

const TCP_RE = /(^|_)(tcp|tool0|grasp_?center|grip_?site|ee_?link|end_?effector)($|_)/i;

const isJoint = (o: unknown): boolean => (o as { isURDFJoint?: boolean }).isURDFJoint === true;
const isLink = (o: unknown): boolean => (o as { isURDFLink?: boolean }).isURDFLink === true;

/**
 * Resolve where the robot actually grasps.
 * Priority: explicit TCP-style leaf link in the URDF → palm link + fingertip-midpoint
 * computed from finger mesh bounds → plain leaf link (no gripper).
 */
export function findToolFrame(robot: URDFRobot, gripSubset?: GripperJoint[]): ToolFrame {
  // 1) the URDF already declares a tool frame (e.g. panda_hand_tcp, tool0) — only
  // trusted when we're not scoped to a specific chain's hand (humanoids have two)
  if (!gripSubset) {
    for (const [name, link] of Object.entries(robot.links)) {
      const leaf = !(link.children ?? []).some(isJoint);
      if (leaf && TCP_RE.test(name)) return { link: name, offset: [0, 0, 0], axis: [0, 0, 1] };
    }
  }

  // 2) jaw gripper: drive the palm, aim for the point between the fingertips
  const grips = gripSubset ?? findGripperJoints(robot);
  if (grips.length > 0) {
    const joints = grips.map((g) => robot.joints[g.name]!).filter(Boolean);
    const palm = joints[0]?.parent as Object3D | undefined;
    const palmName = palm
      ? Object.entries(robot.links).find(([, l]) => (l as unknown) === palm)?.[0]
      : undefined;
    if (palm && palmName) {
      robot.updateMatrixWorld(true);
      const toPalm = new Matrix4().copy(palm.matrixWorld).invert();
      const centers: Vector3[] = [];
      const corners: Vector3[] = [];
      for (const j of joints) {
        const finger = (j.children ?? []).find(isLink) as Object3D | undefined;
        if (!finger) continue;
        const box = new Box3().setFromObject(finger);
        if (box.isEmpty()) {
          centers.push(finger.getWorldPosition(new Vector3()).applyMatrix4(toPalm));
        } else {
          centers.push(box.getCenter(new Vector3()).applyMatrix4(toPalm));
          for (const x of [box.min.x, box.max.x])
            for (const y of [box.min.y, box.max.y])
              for (const z of [box.min.z, box.max.z])
                corners.push(new Vector3(x, y, z).applyMatrix4(toPalm));
        }
      }
      if (centers.length > 0) {
        const mid = centers
          .reduce((acc, c) => acc.add(c), new Vector3())
          .divideScalar(centers.length);
        const axis = mid.lengthSq() > 1e-8 ? mid.clone().normalize() : new Vector3(0, 0, 1);
        const centerT = mid.dot(axis);
        let tipT = -Infinity;
        for (const c of corners) tipT = Math.max(tipT, c.dot(axis));
        // grasp center sits between the finger centroids and the very tips
        const t = tipT > centerT ? centerT + (tipT - centerT) * 0.6 : centerT;
        const off = axis.clone().multiplyScalar(t);
        return {
          link: palmName,
          offset: [off.x, off.y, off.z],
          axis: [axis.x, axis.y, axis.z],
        };
      }
    }
  }

  // 3) no gripper: the leaf link is the tool
  return { link: findEndEffectorLink(robot), offset: [0, 0, 0], axis: [0, 0, 1] };
}
