import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Object3D, Vector3, Quaternion } from "three";
import { loadURDFFromString } from "../src/loadURDF";
import { findToolFrame } from "../src/tool";
import { findGripperJoints } from "../src/gripper";
import { naturalRestPose, solveIK, toolWorldPosition } from "../src/ik";
import { planGrasp, buildGraspTrajectory, carryQuat } from "../src/grasp";
import { sampleTrajectory, interpolateKeyframes, type Keyframe } from "../src/trajectory";
import type { URDFRobot } from "urdf-loader";

const ROBOTS = resolve(__dirname, "../../../apps/web/public/robots");
// skip mesh loading — kinematics come from the URDF alone
const noMesh = (_p: string, _m: unknown, done: (o: Object3D) => void) => done(new Object3D());

function loadReal(rel: string): URDFRobot {
  const xml = readFileSync(resolve(ROBOTS, rel), "utf-8");
  return loadURDFFromString(xml, { loadMeshCb: noMesh });
}

interface PipelineResult {
  kfs: Keyframe[];
  minTCPy: number;
  maxTrackErr: number;
  releasedAt: [number, number, number];
}

/** Replays the app's whole pick-and-place pipeline headlessly and collects safety metrics. */
function runPickPlace(
  robot: URDFRobot,
  cube: [number, number, number],
  target: [number, number, number],
  ready?: Record<string, number>,
): PipelineResult | null {
  const grippers = findGripperJoints(robot);
  const grip = new Set(grippers.map((g) => g.name));
  const jointNames = Object.entries(robot.joints)
    .filter(([, j]) => {
      const t = (j as { jointType?: string }).jointType;
      return (t === "revolute" || t === "continuous" || t === "prismatic") && !grip.has((j as { name: string }).name);
    })
    .map(([n]) => n);
  // ready pose (same path as the app)
  const fallback = naturalRestPose(robot, jointNames);
  jointNames.forEach((n, i) => robot.setJointValue(n, ready?.[n] ?? fallback[i]!));
  robot.updateMatrixWorld(true);

  const tool = findToolFrame(robot);
  const rest = jointNames.map((n) => robot.joints[n]!.angle as number);
  const plan = planGrasp(robot, tool.link, jointNames, cube, {
    candidates: 36,
    reachThreshold: 0.05,
    approachWeight: 2.0,
    tcpOffset: tool.offset,
    toolAxis: tool.axis,
    minApproachY: 0.25,
    clearance: 0.025,
    restPose: rest,
  });
  if (!plan) return null;

  const hp = toolWorldPosition(robot, tool.link, tool.offset);
  const hq = robot.links[tool.link]!.getWorldQuaternion(new Quaternion());
  let kfs = buildGraspTrajectory(plan, {
    homePos: [hp.x, hp.y, hp.z],
    homeQuat: [hq.x, hq.y, hq.z, hq.w],
  });
  const last = kfs[kfs.length - 1]!;
  const q = carryQuat(plan.graspQuat, cube, target);
  const above: [number, number, number] = [target[0], 0.025 + 0.18, target[2]];
  const at: [number, number, number] = [target[0], 0.03, target[2]];
  kfs = [
    ...kfs,
    { t: last.t + 1.2, position: above, quaternion: q, gripper: 1 },
    { t: last.t + 2.0, position: at, quaternion: q, gripper: 1 },
    { t: last.t + 2.6, position: at, quaternion: q, gripper: 0 },
    { t: last.t + 3.4, position: above, quaternion: q, gripper: 0 },
  ];

  // playback simulation at 30 fps, the same warm-started IK the app runs
  const samples = sampleTrajectory(kfs, 30);
  const rotWeight = jointNames.length < 6 ? 0.3 : 1;
  let minTCPy = Infinity;
  let maxTrackErr = 0;
  let released: [number, number, number] | null = null;
  let prevClosed = false;
  for (const s of samples) {
    solveIK(robot, tool.link, jointNames, s.position, s.quaternion, {
      iterations: 30,
      lambda: 0.06,
      tcpOffset: tool.offset,
      restPose: rest,
      restGain: 0.02,
      rotWeight,
      floorY: 0.008,
    });
    const p = toolWorldPosition(robot, tool.link, tool.offset);
    minTCPy = Math.min(minTCPy, p.y);
    const closed = s.gripper > 0.5;
    if (prevClosed && !closed) released = [p.x, 0.025, p.z];
    prevClosed = closed;
    // track only segments that should be on-path (skip the big home transits where
    // intermediate error is fine) — measure at grasp & place dwell points
    const nearGrasp = Math.hypot(s.position[0] - cube[0], s.position[2] - cube[2]) < 0.02;
    const nearPlace = Math.hypot(s.position[0] - target[0], s.position[2] - target[2]) < 0.02;
    if (nearGrasp || nearPlace) {
      maxTrackErr = Math.max(maxTrackErr, p.distanceTo(new Vector3(...s.position)));
    }
  }
  if (!released) throw new Error("gripper never released");
  return { kfs, minTCPy, maxTrackErr, releasedAt: released };
}

describe("pick-and-place integration (real URDFs)", () => {
  it("Panda: grasps a ground cube and places it at the target without digging in", () => {
    const robot = loadReal("panda/panda.urdf");
    const ready = {
      panda_joint1: 0,
      panda_joint2: -0.785,
      panda_joint3: 0,
      panda_joint4: -2.356,
      panda_joint5: 0,
      panda_joint6: 1.571,
      panda_joint7: 0.785,
    };
    const tool = findToolFrame(robot);
    expect(tool.link).toBe("panda_hand_tcp"); // explicit TCP wins
    const res = runPickPlace(robot, [0.42, 0.025, -0.08], [0.5, 0.026, 0.16], ready);
    expect(res).not.toBeNull();
    // TCP never goes below the cube's center height − a small tolerance
    expect(res!.minTCPy).toBeGreaterThan(0.0);
    // tracking at the grasp/place dwells is tight
    expect(res!.maxTrackErr).toBeLessThan(0.02);
    // the cube is released over the target (settles at target XZ)
    expect(Math.hypot(res!.releasedAt[0] - 0.5, res!.releasedAt[2] - 0.16)).toBeLessThan(0.02);
    // joint limits respected at the end of playback
    for (const [name, j] of Object.entries(robot.joints)) {
      const jt = (j as { jointType?: string }).jointType;
      if (jt !== "revolute" && jt !== "prismatic") continue;
      const lim = (j as { limit?: { lower?: number; upper?: number } }).limit ?? {};
      const a = j.angle as number;
      expect(a).toBeGreaterThanOrEqual(Number(lim.lower ?? -Infinity) - 1e-6);
      expect(a).toBeLessThanOrEqual(Number(lim.upper ?? Infinity) + 1e-6);
      void name;
    }
  });

  it("SO-101: palm-driven tool frame grasps and places a nearer cube", () => {
    const robot = loadReal("so101_gripper/so101_gripper.urdf");
    const tool = findToolFrame(robot);
    // must drive the palm (link5_1), never a moving clamp finger
    expect(tool.link).toBe("link5_1");
    expect(Math.hypot(...tool.offset)).toBeGreaterThan(0.05); // real TCP offset found
    // SO-101's workspace faces +Z with ~0.35m reach — pick spots it can actually serve
    const res = runPickPlace(robot, [0.06, 0.025, 0.26], [-0.1, 0.026, 0.22]);
    expect(res).not.toBeNull();
    expect(res!.minTCPy).toBeGreaterThan(0.0);
    expect(Math.hypot(res!.releasedAt[0] + 0.1, res!.releasedAt[2] - 0.22)).toBeLessThan(0.03);
  });
});

describe("PiPER (downloaded preset)", () => {
  it("detects joint7/8 as the gripper and completes a pick-and-place", () => {
    const robot = loadReal("piper/piper.urdf");
    const grips = findGripperJoints(robot);
    expect(grips.map((g) => g.name)).toEqual(["joint7", "joint8"]);
    const tool = findToolFrame(robot);
    expect(tool.link).toBe("gripper_base");
    const ready = { joint1: 0, joint2: 1.0, joint3: -0.9, joint4: 0, joint5: 0.7, joint6: 0 };
    const res = runPickPlace(robot, [0.32, 0.025, 0.06], [0.26, 0.026, 0.2], ready);
    expect(res).not.toBeNull();
    expect(res!.minTCPy).toBeGreaterThan(0.0);
    expect(res!.maxTrackErr).toBeLessThan(0.02);
    expect(Math.hypot(res!.releasedAt[0] - 0.26, res!.releasedAt[2] - 0.2)).toBeLessThan(0.02);
  });
});
