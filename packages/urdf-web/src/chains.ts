import type { Object3D } from "three";
import type { URDFRobot } from "urdf-loader";
import { findGripperJoints, type GripperJoint } from "./gripper";

export interface KinematicChain {
  /** Heuristic label, e.g. "left arm", "right leg", "arm". */
  name: string;
  /** Movable joints from base to tip, gripper joints excluded — what IK drives. */
  joints: string[];
  /** Gripper joints living at this chain's tip (only this chain's hand). */
  gripperJoints: string[];
  /** The link IK should treat as the end of the chain (palm for hands, else the leaf). */
  tipLink: string;
  /** Higher = better default (has a gripper, arm-like names, longer reach). */
  score: number;
}

const MOVABLE = new Set(["revolute", "continuous", "prismatic"]);
const ARM_RE = /shoulder|elbow|wrist|arm|hand|gripper|finger|clamp|claw/i;
const LEG_RE = /hip|knee|ankle|leg|foot|wheel/i;

const isJoint = (o: unknown): o is Object3D & { jointType?: string; name: string } =>
  (o as { isURDFJoint?: boolean }).isURDFJoint === true;
const isLink = (o: unknown): o is Object3D & { name: string } =>
  (o as { isURDFLink?: boolean }).isURDFLink === true;

/**
 * Enumerate the robot's base→leaf kinematic chains. A plain arm yields one chain (its
 * old joint list, unchanged); a humanoid yields arms, legs, head… so the editor can
 * drive ONE chain and freeze the rest — the "planning group" idea from SRDF, derived
 * automatically. Chains are sorted best-default-first: hands beat handless limbs,
 * arm-ish names beat leg-ish names, longer chains beat stubs.
 */
export function findKinematicChains(robot: URDFRobot): KinematicChain[] {
  const grips = findGripperJoints(robot);
  const gripNames = new Set(grips.map((g) => g.name));

  interface Leaf {
    movable: string[]; // movable joint names along the path, in order
    leafLink: string;
  }
  const leaves: Leaf[] = [];
  const walk = (node: Object3D, path: string[]) => {
    const childJoints = (node.children ?? []).filter(isJoint);
    const childLinks = (node.children ?? []).filter(isLink);
    if (isLink(node) && childJoints.length === 0 && childLinks.length === 0) {
      if (path.length) leaves.push({ movable: [...path], leafLink: node.name });
      return;
    }
    let descended = false;
    for (const j of childJoints) {
      const next = MOVABLE.has(j.jointType ?? "") ? [...path, j.name] : path;
      for (const c of j.children ?? []) {
        walk(c as Object3D, next);
        descended = true;
      }
      if ((j.children ?? []).length === 0 && MOVABLE.has(j.jointType ?? "")) {
        // joint with no child link parsed — treat the joint itself as a leaf
        leaves.push({ movable: [...path, j.name], leafLink: j.name });
        descended = true;
      }
    }
    for (const l of childLinks) {
      walk(l, path);
      descended = true;
    }
    // a link whose only children are meshes ends the chain
    if (!descended && isLink(node) && path.length) {
      leaves.push({ movable: [...path], leafLink: node.name });
    }
  };
  walk(robot as unknown as Object3D, []);

  // group leaves by their arm-joint sequence (a two-finger hand has 2+ leaves)
  const byArm = new Map<string, { joints: string[]; grippers: Set<string>; leafLinks: string[] }>();
  for (const leaf of leaves) {
    const armJoints = leaf.movable.filter((j) => !gripNames.has(j));
    if (armJoints.length === 0) continue;
    const key = armJoints.join("|");
    const entry = byArm.get(key) ?? { joints: armJoints, grippers: new Set<string>(), leafLinks: [] };
    for (const j of leaf.movable) if (gripNames.has(j)) entry.grippers.add(j);
    entry.leafLinks.push(leaf.leafLink);
    byArm.set(key, entry);
  }

  // drop chains that are strict prefixes of another chain (intermediate sensor stubs)
  const entries = [...byArm.values()];
  const keys = entries.map((e) => e.joints.join("|") + "|");
  const chains: KinematicChain[] = [];
  for (let i = 0; i < entries.length; i++) {
    const isPrefix = keys.some((k, j) => j !== i && k.startsWith(keys[i]!));
    if (isPrefix && entries[i]!.grippers.size === 0) continue;
    const e = entries[i]!;
    const text = e.joints.join(",");
    const armHits = e.joints.filter((j) => ARM_RE.test(j)).length;
    const legHits = e.joints.filter((j) => LEG_RE.test(j)).length;
    const score = (e.grippers.size > 0 ? 100 : 0) + armHits * 8 - legHits * 8 + e.joints.length;
    // tip = the gripper joints' parent link (the palm), else the first leaf link
    let tipLink = e.leafLinks[0]!;
    if (e.grippers.size > 0) {
      const g = robot.joints[[...e.grippers][0]!] as unknown as { parent?: { name?: string } };
      if (g?.parent?.name) tipLink = g.parent.name;
    }
    const side = /(?:^|[_,])left[_,]/i.test("," + text) ? "left " : /(?:^|[_,])right[_,]/i.test("," + text) ? "right " : "";
    const kind = legHits > armHits ? "leg" : armHits > 0 || e.grippers.size > 0 ? "arm" : "chain";
    chains.push({
      name: `${side}${kind}`,
      joints: e.joints,
      gripperJoints: [...e.grippers].sort(),
      tipLink,
      score,
    });
  }
  chains.sort((a, b) => b.score - a.score);
  // disambiguate duplicate names (e.g. two unnamed chains)
  const seen = new Map<string, number>();
  for (const c of chains) {
    const n = seen.get(c.name) ?? 0;
    seen.set(c.name, n + 1);
    if (n > 0) c.name = `${c.name} ${n + 1}`;
  }
  return chains;
}

/** The gripper-joint descriptors for one chain (subset of the robot's full set). */
export function chainGrippers(robot: URDFRobot, chain: KinematicChain): GripperJoint[] {
  const set = new Set(chain.gripperJoints);
  return findGripperJoints(robot).filter((g) => set.has(g.name));
}
