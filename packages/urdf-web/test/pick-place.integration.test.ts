import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Object3D, Vector3, Quaternion } from "three";
import { loadURDFFromString } from "../src/loadURDF";
import { findToolFrame } from "../src/tool";
import { findGripperJoints, calibrateGripper } from "../src/gripper";
import { findKinematicChains, chainGrippers } from "../src/chains";
import { stlMeshLoaderFor } from "./helpers/stlMeshes";
import { naturalRestPose, solveIK, toolWorldPosition } from "../src/ik";
import { planGrasp, buildGraspTrajectory, carryQuat } from "../src/grasp";
import { sampleTrajectory, interpolateKeyframes, type Keyframe } from "../src/trajectory";
import type { URDFRobot } from "urdf-loader";

const ROBOTS = resolve(__dirname, "../../../apps/web/public/robots");
// skip mesh loading — kinematics come from the URDF alone
const noMesh = (_p: string, _m: unknown, done: (o: Object3D) => void) => done(new Object3D());

function loadReal(rel: string, withMeshes = false): URDFRobot {
  const xml = readFileSync(resolve(ROBOTS, rel), "utf-8");
  const dir = resolve(ROBOTS, rel, "..");
  return loadURDFFromString(xml, { loadMeshCb: withMeshes ? stlMeshLoaderFor(dir) : noMesh });
}

interface PipelineResult {
  kfs: Keyframe[];
  minTCPy: number;
  maxTrackErr: number;
  releasedAt: [number, number, number];
  /** TCP-to-cube distance at the moment the gripper closes (the app's grasp gate). */
  graspDist: number;
}

/** Replays the app's whole pick-and-place pipeline headlessly and collects safety metrics. */
function runPickPlace(
  robot: URDFRobot,
  cube: [number, number, number],
  target: [number, number, number],
  ready?: Record<string, number>,
  chain?: { joints: string[]; grippers: ReturnType<typeof findGripperJoints> },
): PipelineResult | null {
  const grippers = chain?.grippers ?? findGripperJoints(robot);
  const grip = new Set(grippers.map((g) => g.name));
  const jointNames =
    chain?.joints ??
    Object.entries(robot.joints)
      .filter(([, j]) => {
        const t = (j as { jointType?: string }).jointType;
        return (t === "revolute" || t === "continuous" || t === "prismatic") && !grip.has((j as { name: string }).name);
      })
      .map(([n]) => n);
  // ready pose (same path as the app)
  const fallback = naturalRestPose(robot, jointNames);
  jointNames.forEach((n, i) => robot.setJointValue(n, ready?.[n] ?? fallback[i]!));
  robot.updateMatrixWorld(true);

  // calibrated bite point when meshes are available (same priority as the app)
  const calib = calibrateGripper(robot, grippers);
  let tool = findToolFrame(robot, chain ? grippers : undefined);
  if (calib) {
    const len = Math.hypot(...calib.tcp);
    tool = {
      link: calib.palmLink,
      offset: calib.tcp,
      axis:
        len > 1e-3
          ? ([calib.tcp[0] / len, calib.tcp[1] / len, calib.tcp[2] / len] as [number, number, number])
          : tool.axis,
    };
  }
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
  const above: [number, number, number] = [target[0], target[1] + 0.18, target[2]];
  const at: [number, number, number] = [target[0], target[1] + 0.005, target[2]];
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
  let graspDist = Infinity;
  let prevClosed = false;
  for (const s of samples) {
    solveIK(robot, tool.link, jointNames, s.position, s.quaternion, {
      iterations: 30,
      lambda: 0.06,
      tcpOffset: tool.offset,
      restPose: rest,
      restGain: 0.02,
      rotWeight,
      floorY: Math.min(cube[1], target[1]) - 0.02,
    });
    const p = toolWorldPosition(robot, tool.link, tool.offset);
    minTCPy = Math.min(minTCPy, p.y);
    const closed = s.gripper > 0.5;
    if (closed && !prevClosed) {
      graspDist = Math.min(
        graspDist,
        Math.hypot(p.x - cube[0], p.y - cube[1], p.z - cube[2]),
      );
    }
    if (prevClosed && !closed) released = [p.x, target[1], p.z];
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
  return { kfs, minTCPy, maxTrackErr, releasedAt: released, graspDist };
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

describe("calibrated grippers (real meshes)", () => {
  it("SO-101 grasps within the gate radius and places at the target", () => {
    const robot = loadReal("so101_gripper/so101_gripper.urdf", true);
    const res = runPickPlace(robot, [0.06, 0.025, 0.26], [-0.1, 0.026, 0.22]);
    expect(res).not.toBeNull();
    expect(res!.graspDist).toBeLessThan(0.06); // the grasp gate would actually grab
    expect(res!.minTCPy).toBeGreaterThan(0.0);
    expect(Math.hypot(res!.releasedAt[0] + 0.1, res!.releasedAt[2] - 0.22)).toBeLessThan(0.03);
  });

  it("PiPER grasps within the gate radius and places at the target", () => {
    const robot = loadReal("piper/piper.urdf", true);
    const ready = { joint1: 0, joint2: 1.0, joint3: -0.9, joint4: 0, joint5: 0.7, joint6: 0 };
    const res = runPickPlace(robot, [0.32, 0.025, 0.06], [0.26, 0.026, 0.2], ready);
    expect(res).not.toBeNull();
    expect(res!.graspDist).toBeLessThan(0.06);
    expect(res!.minTCPy).toBeGreaterThan(0.0);
    expect(Math.hypot(res!.releasedAt[0] - 0.26, res!.releasedAt[2] - 0.2)).toBeLessThan(0.025);
  });

  it("SO-100 single-jaw grasps within the gate radius", () => {
    const robot = loadReal("so100/so100.urdf", true);
    const ready = { shoulder_pan: 0, shoulder_lift: 0.6, elbow_flex: -1.1, wrist_flex: -0.5 };
    const res = runPickPlace(robot, [0.0, 0.025, 0.24], [0.12, 0.026, 0.2], ready);
    expect(res).not.toBeNull();
    expect(res!.graspDist).toBeLessThan(0.06);
    expect(Math.hypot(res!.releasedAt[0] - 0.12, res!.releasedAt[2] - 0.2)).toBeLessThan(0.04);
  });
});

describe("replanning regression (the second-run bug)", () => {
  it("Panda: a second plan after moving cube and target still lands on target", () => {
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
    const r1 = runPickPlace(robot, [0.42, 0.025, -0.08], [0.5, 0.026, 0.16], ready);
    expect(r1).not.toBeNull();
    // user drags the cube & target somewhere else and replans on the SAME robot
    const r2 = runPickPlace(robot, [0.36, 0.025, 0.18], [0.45, 0.026, -0.05], ready);
    expect(r2).not.toBeNull();
    expect(r2!.graspDist).toBeLessThan(0.06);
    expect(Math.hypot(r2!.releasedAt[0] - 0.45, r2!.releasedAt[2] + 0.05)).toBeLessThan(0.02);
    expect(r2!.minTCPy).toBeGreaterThan(0.0);
  });
});

describe("G1 humanoid (chain-scoped pick-and-place on a table)", () => {
  it("drives one arm chain, calibrates that hand, and places on the table", { timeout: 60000 }, () => {
    const robot = loadReal("g1/g1.urdf", true);
    const chains = findKinematicChains(robot);
    const arm = chains[0]!;
    expect(arm.gripperJoints).toHaveLength(2);
    const grippers = chainGrippers(robot, arm);
    // raise the arm to a working pose in front of the chest before probing reach
    const ready: Record<string, number> = {};
    for (const j of arm.joints) ready[j] = 0;
    const side = arm.joints.some((j) => j.startsWith("left_")) ? "left" : "right";
    const sign = side === "left" ? 1 : -1;
    ready[`${side}_shoulder_pitch_joint`] = -0.4;
    ready[`${side}_shoulder_roll_joint`] = sign * 0.25;
    ready[`${side}_elbow_joint`] = 0.9;
    for (const [n, v] of Object.entries(ready)) robot.setJointValue(n, v);
    robot.updateMatrixWorld(true);
    const tool = findToolFrame(robot, grippers);
    const tcp = toolWorldPosition(robot, tool.link, tool.offset);
    // table-top cube right under the hand's hover point, slightly forward
    const cube: [number, number, number] = [tcp.x * 1.05, tcp.y - 0.18, tcp.z * 1.05];
    const target: [number, number, number] = [cube[0], cube[1] + 0.001, cube[2] + sign * 0.16];
    const res = runPickPlace(robot, cube, target, ready, { joints: arm.joints, grippers });
    expect(res).not.toBeNull();
    expect(res!.graspDist).toBeLessThan(0.06);
    expect(Math.hypot(res!.releasedAt[0] - target[0], res!.releasedAt[2] - target[2])).toBeLessThan(0.03);
  });
});
