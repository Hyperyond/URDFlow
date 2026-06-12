/**
 * Trajectory quality control — the kinematic inspection pass of the data-QC
 * engine. Replays a MotionClip through the robot's forward kinematics and
 * scores the artifacts that make episodes untrainable:
 *
 *  - foot skating: a supporting foot translating while in contact
 *  - ground penetration: links sinking below the ground plane
 *  - joint-limit violations: commanded positions outside URDF limits
 *  - teleports: base jumps between consecutive frames
 *  - jerk: per-joint third-derivative RMS (reported, not yet scored)
 *
 * Pure computation on the urdf-loader scene graph — no rendering, no DOM —
 * so the same code runs in the browser storefront and a future CLI/server.
 * The robot object's pose/joints are mutated during analysis; callers that
 * also render should re-apply their own state afterwards.
 */

import { Quaternion, Vector3 } from "three";
import type { URDFRobot } from "urdf-loader";
import type { MotionClip } from "./motion";
import { frameAt } from "./motion";

export type QCIssueType = "foot_skate" | "ground_penetration" | "joint_limit" | "teleport";

export interface QCIssue {
  type: QCIssueType;
  /** first frame of the incident */
  frame: number;
  /** seconds into the clip */
  time: number;
  /** 0..1, relative badness within its type */
  severity: number;
  /** human-readable, e.g. "left foot slides 4.2cm while in contact" */
  detail: string;
  link?: string;
  joint?: string;
}

export interface QCMetrics {
  /** total distance (m) feet translated while judged in contact */
  footSkateDistance: number;
  /** deepest link origin below ground (m, ≥0) */
  maxPenetration: number;
  /** frames with at least one joint outside its URDF limits */
  limitViolationFrames: number;
  /** worst limit overshoot (rad) */
  maxLimitOvershoot: number;
  /** base jumps above the teleport threshold */
  teleportCount: number;
  /** mean per-joint |jerk| (rad/s^3) */
  meanJerk: number;
  /** highest per-joint |jerk| and where */
  peakJerk: number;
  peakJerkJoint: string | null;
}

export interface QCReport {
  /** 0–100; 100 = no detected artifacts */
  score: number;
  metrics: QCMetrics;
  issues: QCIssue[];
  frames: number;
  duration: number;
}

export interface QCOptions {
  /** clip joint order → robot joint names (required) */
  jointNames: string[];
  /** foot link names; default: links matching /ankle_roll|foot|sole/i */
  footLinks?: string[];
  /** vertical speed below which a foot counts as planted (m/s) */
  contactVelThreshold?: number;
  /** horizontal speed above which a planted foot is skating (m/s) */
  skateSpeedThreshold?: number;
  /** ground plane height in the Z-up world (m) */
  groundZ?: number;
  /** link origin must sink this far below ground to count (m) */
  penetrationTol?: number;
  /** base translation per frame that counts as a teleport (m) */
  teleportThreshold?: number;
}

const DEFAULTS = {
  contactVelThreshold: 0.08,
  skateSpeedThreshold: 0.15,
  groundZ: 0,
  penetrationTol: 0.03,
  teleportThreshold: 0.2,
};

interface LinkLike {
  matrixWorld: { elements: number[] };
}

function worldPos(link: LinkLike, out: Vector3): Vector3 {
  const e = link.matrixWorld.elements;
  return out.set(e[12]!, e[13]!, e[14]!);
}

/** Default foot-link detection by name. */
export function findFootLinks(robot: URDFRobot): string[] {
  const names = Object.keys(robot.links);
  const feet = names.filter((n) => /ankle_roll|foot|sole/i.test(n));
  // prefer the most distal match per side: ankle_roll over ankle_pitch etc.
  return feet.length > 0 ? feet : [];
}

interface FootGroup {
  name: string;
  links: string[];
}

/**
 * Collapse per-foot helper links (collision spheres, toe pads…) into one foot:
 * "left_ankle_roll_sphere_3_link" and "left_ankle_roll_link" are the same foot.
 * Skating is then judged on the group centroid, so a foot pivoting about its
 * ankle (points sweeping arcs, centroid still) is not a slide.
 */
export function groupFootLinks(footNames: string[]): FootGroup[] {
  const groups = new Map<string, string[]>();
  for (const n of footNames) {
    const m = /^(.*?(?:ankle_roll|foot|sole))/i.exec(n);
    const key = m ? m[1]! : n;
    const list = groups.get(key);
    if (list) list.push(n);
    else groups.set(key, [n]);
  }
  return [...groups.entries()].map(([name, links]) => ({ name, links }));
}

/** Replay the clip through FK and produce a quality report. */
export function analyzeClip(robot: URDFRobot, clip: MotionClip, options: QCOptions): QCReport {
  const opts = { ...DEFAULTS, ...options };
  const jointNames = options.jointNames;
  if (jointNames.length < clip.jointCount) {
    throw new Error(`need ${clip.jointCount} joint names, got ${jointNames.length}`);
  }
  const footNames = options.footLinks ?? findFootLinks(robot);
  const footGroups = groupFootLinks(footNames)
    .map((g) => ({
      name: g.name,
      links: g.links.map((n) => robot.links[n]).filter((l): l is NonNullable<typeof l> => !!l),
    }))
    .filter((g) => g.links.length > 0);

  // joint limits from the URDF (urdf-loader exposes limit.{lower,upper})
  const limits = jointNames.slice(0, clip.jointCount).map((n) => {
    const j = robot.joints[n] as unknown as
      | { jointType?: string; limit?: { lower?: number; upper?: number } }
      | undefined;
    if (!j || j.jointType === "continuous" || !j.limit) return null;
    const lo = j.limit.lower;
    const hi = j.limit.upper;
    if (typeof lo !== "number" || typeof hi !== "number" || lo >= hi) return null;
    return { lo, hi };
  });

  // analysis happens in the renderer's Y-up frame: base z-up pose → p=(x,z,-y), q=Rx(-90°)∘q
  const qx90 = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  const tmpQ = new Quaternion();
  const groundY = opts.groundZ;

  const dt = 1 / clip.fps;
  const T = clip.frames;
  const nFeet = footGroups.length;
  const footPos = new Float64Array(T * nFeet * 3);
  const minLinkY = new Float64Array(T).fill(Infinity);
  const minLinkYName: (string | null)[] = new Array(T).fill(null);
  const basePos = new Float64Array(T * 3);
  const allLinks = Object.entries(robot.links);
  const v = new Vector3();

  for (let t = 0; t < T; t++) {
    const f = frameAt(clip, t);
    robot.position.set(f.base.pos[0], f.base.pos[2], -f.base.pos[1]);
    tmpQ.set(f.base.quat[1], f.base.quat[2], f.base.quat[3], f.base.quat[0]);
    robot.quaternion.copy(qx90).multiply(tmpQ);
    for (let j = 0; j < clip.jointCount; j++) robot.setJointValue(jointNames[j]!, f.joints[j]!);
    robot.updateMatrixWorld(true);

    basePos[t * 3] = robot.position.x;
    basePos[t * 3 + 1] = robot.position.y;
    basePos[t * 3 + 2] = robot.position.z;
    for (let k = 0; k < nFeet; k++) {
      // foot position = centroid of the group's links
      let cx = 0;
      let cy = 0;
      let cz = 0;
      const links = footGroups[k]!.links;
      for (const l of links) {
        worldPos(l as unknown as LinkLike, v);
        cx += v.x;
        cy += v.y;
        cz += v.z;
      }
      footPos[(t * nFeet + k) * 3] = cx / links.length;
      footPos[(t * nFeet + k) * 3 + 1] = cy / links.length;
      footPos[(t * nFeet + k) * 3 + 2] = cz / links.length;
    }
    for (const [name, link] of allLinks) {
      worldPos(link as unknown as LinkLike, v);
      if (v.y < minLinkY[t]!) {
        minLinkY[t] = v.y;
        minLinkYName[t] = name;
      }
    }
  }

  const issues: QCIssue[] = [];

  // ---- foot skating: planted feet (lowest foot, ~zero vertical speed) must not translate ----
  let skateDistance = 0;
  let skateRun: { start: number; dist: number; link: string } | null = null;
  for (let t = 1; t < T; t++) {
    let worst: { name: string; horiz: number } | null = null;
    // find the supporting foot: the lowest one this frame
    let lowestK = -1;
    let lowestY = Infinity;
    for (let k = 0; k < nFeet; k++) {
      const y = footPos[(t * nFeet + k) * 3 + 1]!;
      if (y < lowestY) {
        lowestY = y;
        lowestK = k;
      }
    }
    if (lowestK >= 0) {
      const k = lowestK;
      const i = (t * nFeet + k) * 3;
      const p = ((t - 1) * nFeet + k) * 3;
      const vy = Math.abs(footPos[i + 1]! - footPos[p + 1]!) / dt;
      const horiz = Math.hypot(footPos[i]! - footPos[p]!, footPos[i + 2]! - footPos[p + 2]!) / dt;
      if (vy < opts.contactVelThreshold && horiz > opts.skateSpeedThreshold) {
        worst = { name: footGroups[k]!.name, horiz };
      }
    }
    if (worst) {
      const d = worst.horiz * dt;
      skateDistance += d;
      if (skateRun && skateRun.link === worst.name) skateRun.dist += d;
      else {
        if (skateRun) flushSkate(skateRun);
        skateRun = { start: t, dist: d, link: worst.name };
      }
    } else if (skateRun) {
      flushSkate(skateRun);
      skateRun = null;
    }
  }
  if (skateRun) flushSkate(skateRun);
  function flushSkate(run: { start: number; dist: number; link: string }): void {
    if (run.dist < 0.01) return; // sub-centimeter noise
    issues.push({
      type: "foot_skate",
      frame: run.start,
      time: run.start * dt,
      severity: Math.min(1, run.dist / 0.2),
      detail: `${run.link} skates ${(run.dist * 100).toFixed(1)}cm while in contact`,
      link: run.link,
    });
  }

  // ---- ground penetration ----
  let maxPenetration = 0;
  let penRun: { start: number; depth: number; link: string } | null = null;
  for (let t = 0; t < T; t++) {
    const depth = groundY - minLinkY[t]!;
    if (depth > opts.penetrationTol) {
      maxPenetration = Math.max(maxPenetration, depth);
      if (!penRun) penRun = { start: t, depth, link: minLinkYName[t] ?? "?" };
      else penRun.depth = Math.max(penRun.depth, depth);
    } else if (penRun) {
      issues.push({
        type: "ground_penetration",
        frame: penRun.start,
        time: penRun.start * dt,
        severity: Math.min(1, penRun.depth / 0.1),
        detail: `${penRun.link} penetrates ground ${(penRun.depth * 100).toFixed(1)}cm`,
        link: penRun.link,
      });
      penRun = null;
    }
  }
  if (penRun) {
    issues.push({
      type: "ground_penetration",
      frame: penRun.start,
      time: penRun.start * dt,
      severity: Math.min(1, penRun.depth / 0.1),
      detail: `${penRun.link} penetrates ground ${(penRun.depth * 100).toFixed(1)}cm`,
      link: penRun.link,
    });
  }

  // ---- joint limits ----
  let limitViolationFrames = 0;
  let maxLimitOvershoot = 0;
  const violatedJoints = new Map<string, { frame: number; overshoot: number }>();
  for (let t = 0; t < T; t++) {
    const f = frameAt(clip, t);
    let frameHasViolation = false;
    for (let j = 0; j < clip.jointCount; j++) {
      const lim = limits[j];
      if (!lim) continue;
      const q = f.joints[j]!;
      const over = Math.max(lim.lo - q, q - lim.hi);
      if (over > 1e-4) {
        frameHasViolation = true;
        maxLimitOvershoot = Math.max(maxLimitOvershoot, over);
        const name = jointNames[j]!;
        const prev = violatedJoints.get(name);
        if (!prev || over > prev.overshoot) violatedJoints.set(name, { frame: t, overshoot: over });
      }
    }
    if (frameHasViolation) limitViolationFrames++;
  }
  for (const [joint, hit] of violatedJoints) {
    issues.push({
      type: "joint_limit",
      frame: hit.frame,
      time: hit.frame * dt,
      severity: Math.min(1, hit.overshoot / 0.2),
      detail: `${joint} exceeds limit by ${((hit.overshoot * 180) / Math.PI).toFixed(1)}°`,
      joint,
    });
  }

  // ---- teleports ----
  let teleportCount = 0;
  for (let t = 1; t < T; t++) {
    const dx = basePos[t * 3]! - basePos[(t - 1) * 3]!;
    const dy = basePos[t * 3 + 1]! - basePos[(t - 1) * 3 + 1]!;
    const dz = basePos[t * 3 + 2]! - basePos[(t - 1) * 3 + 2]!;
    const d = Math.hypot(dx, dy, dz);
    if (d > opts.teleportThreshold) {
      teleportCount++;
      issues.push({
        type: "teleport",
        frame: t,
        time: t * dt,
        severity: Math.min(1, d / 1.0),
        detail: `base teleports ${(d * 100).toFixed(0)}cm in one frame`,
      });
    }
  }

  // ---- jerk (reported only) ----
  let jerkSum = 0;
  let jerkCount = 0;
  let peakJerk = 0;
  let peakJerkJoint: string | null = null;
  if (T >= 4) {
    for (let j = 0; j < clip.jointCount; j++) {
      for (let t = 3; t < T; t++) {
        const q0 = clip.qpos[(t - 3) * clip.dim + 7 + j]!;
        const q1 = clip.qpos[(t - 2) * clip.dim + 7 + j]!;
        const q2 = clip.qpos[(t - 1) * clip.dim + 7 + j]!;
        const q3 = clip.qpos[t * clip.dim + 7 + j]!;
        const jerk = Math.abs(q3 - 3 * q2 + 3 * q1 - q0) / (dt * dt * dt);
        jerkSum += jerk;
        jerkCount++;
        if (jerk > peakJerk) {
          peakJerk = jerk;
          peakJerkJoint = jointNames[j]!;
        }
      }
    }
  }

  const metrics: QCMetrics = {
    footSkateDistance: skateDistance,
    maxPenetration,
    limitViolationFrames,
    maxLimitOvershoot,
    teleportCount,
    meanJerk: jerkCount > 0 ? jerkSum / jerkCount : 0,
    peakJerk,
    peakJerkJoint,
  };

  // ---- score: 100 minus capped penalties per artifact family ----
  const skatePenalty = Math.min(30, (skateDistance / 0.1) * 5);
  const penPenalty = Math.min(30, (maxPenetration / 0.01) * 5);
  const limitPenalty = Math.min(20, violatedJoints.size * 5);
  const teleportPenalty = Math.min(20, teleportCount * 10);
  const score = Math.max(0, Math.round(100 - skatePenalty - penPenalty - limitPenalty - teleportPenalty));

  issues.sort((a, b) => a.frame - b.frame);
  return { score, metrics, issues, frames: T, duration: clip.duration };
}
