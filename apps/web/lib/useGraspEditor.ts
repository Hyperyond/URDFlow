"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Quaternion, Vector3 } from "three";
import {
  findToolFrame,
  findKinematicChains,
  chainGrippers,
  applyBasePose,
  planGrasp,
  buildGraspTrajectory,
  carryQuat,
  interpolateKeyframes,
  sampleTrajectory,
  toLeRobotFrames,
  solveIK,
  toolWorldPosition,
  findGripperJoints,
  applyGripper,
  closureForWidth,
  calibrateGripper,
  applyGripperCalibrated,
  type BasePose,
  type GripperCalibration,
  type KinematicChain,
  type ToolFrame,
  type GripperJoint,
  type JointInfo,
  type URDFRobot,
  type Keyframe,
} from "@urdflow/urdf-web";
import { downloadJSON } from "./download";
import type { SceneSpec } from "./sceneTypes";

const smooth = (u: number) => u * u * (3 - 2 * u);

/** Side length of the scene cubes (must match RobotViewer's boxGeometry). */
export const CUBE_SIZE = 0.05;
const CUBE_HALF = CUBE_SIZE / 2;
/** The gripper only actually grabs when the TCP is this close to the cube center. */
const GRASP_RADIUS = 0.06;

export interface SceneObject {
  id: string;
  position: [number, number, number];
  color?: string;
}
export interface SceneTarget {
  id: string;
  position: [number, number, number];
}

/** One pick-and-place pass of the program: which cube is in hand during [start, end]. */
interface ProgramSegment {
  cubeId: string;
  start: number;
  end: number;
}

/**
 * Incremental planning state. Cubes are planned ONE segment at a time: the first
 * synchronously on Generate, the rest lazily from the playback loop as the playhead
 * reaches the end of what's planned. Single-segment latency instead of an upfront
 * whole-program solve, and each segment eases in from the arm's REAL playback pose
 * (the old plan-everything path chained per-segment park IK and accumulated drift).
 */
interface PlanJob {
  queue: string[]; // cube ids in pick order
  idx: number; // next queue index to plan
  chainIdx: number;
  names: string[];
  rest: number[];
  anchorR: number; // hand hover radius at program start — place-reach sanity bound
  home0: Keyframe;
  endT: number; // time offset for the next segment
  skipped: number[];
  handNote: string | null;
  done: boolean;
}

/** A base-motion window: the robot glides/turns, the arm holds still, IK is skipped. */
interface WalkSegment {
  t0: number;
  t1: number;
  from: BasePose;
  to: BasePose;
}

const lerpAngle = (a: number, b: number, u: number) => {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * u;
};

/**
 * Ground spot under the gripper's current hover point, pulled slightly inward and
 * optionally swung around the base — lands inside the robot's workspace for any model.
 */
function spawnSpot(
  robot: URDFRobot | null,
  tool: ToolFrame | null,
  swing: number,
): [number, number] {
  let x = 0.42;
  let z = -0.08;
  if (robot && tool) {
    const p = toolWorldPosition(robot, tool.link, tool.offset);
    x = p.x * 0.9 + robot.position.x * 0.1;
    z = p.z * 0.9 + robot.position.z * 0.1;
    const r = Math.hypot(x - robot.position.x, z - robot.position.z);
    if (r < 0.12) {
      // gripper hovers over the base — push out to a workable radius along the same azimuth
      const s = r < 1e-6 ? 0 : 0.18 / r;
      x = robot.position.x + (r < 1e-6 ? 0.18 : (x - robot.position.x) * s);
      z = robot.position.z + (r < 1e-6 ? 0 : (z - robot.position.z) * s);
    }
  }
  if (swing !== 0) {
    const c = Math.cos(swing);
    const s = Math.sin(swing);
    return [x * c - z * s, x * s + z * c];
  }
  return [x, z];
}

export function useGraspEditor(robot: URDFRobot | null, model: JointInfo[]) {
  const [objects, setObjects] = useState<SceneObject[]>([]);
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const [targets, setTargets] = useState<SceneTarget[]>([]);
  const targetsRef = useRef(targets);
  targetsRef.current = targets;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const idRef = useRef(0);
  const playheadRef = useRef(0);
  const toolByChainRef = useRef(new Map<number, ToolFrame>());
  const calibByChainRef = useRef(new Map<number, GripperCalibration | null>());
  const fullReadyRef = useRef<Record<string, number> | null>(null);
  const restRef = useRef<number[] | null>(null);
  const softLimitsRef = useRef<Record<string, { lower: number; upper: number }>>({});
  const carriedRef = useRef(false);
  const grabbedRef = useRef(false);
  const segmentsRef = useRef<ProgramSegment[]>([]);
  const walkSegsRef = useRef<WalkSegment[]>([]);
  const planJobRef = useRef<PlanJob | null>(null);
  // timeline curves are recorded live at 20 Hz during playback (no upfront solve)
  const trackRecRef = useRef<{ nextT: number; tracks: { name: string; values: number[] }[] } | null>(null);
  const baseRef = useRef<BasePose>({ x: 0, z: 0, yaw: 0 });
  const programBaseRef = useRef<BasePose>({ x: 0, z: 0, yaw: 0 });
  const planSceneRef = useRef<string | null>(null);
  const [chains, setChains] = useState<KinematicChain[]>([]);
  const [activeChainIdx, setActiveChainIdx] = useState(0);
  const [autoHand, setAutoHand] = useState(true);
  const [surfaceY, setSurfaceY] = useState(0);
  const surfaceYRef = useRef(0);
  surfaceYRef.current = surfaceY;
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [jointTracks, setJointTracks] = useState<{ name: string; values: number[] }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const activeChain = chains[activeChainIdx] ?? null;
  // gripper joints scoped to the active chain — a humanoid's other hand stays put
  const gripperJoints = useMemo<GripperJoint[]>(() => {
    if (!robot) return [];
    if (activeChain) return chainGrippers(robot, activeChain);
    return findGripperJoints(robot);
  }, [robot, activeChain]);
  // arm joints of the active chain only — the rest of the body is frozen at ready
  const jointNames = useMemo(() => {
    if (activeChain) return activeChain.joints;
    const grip = new Set(gripperJoints.map((g) => g.name));
    return model.map((m) => m.name).filter((n) => !grip.has(n));
  }, [model, gripperJoints, activeChain]);
  // under-actuated arms (e.g. 5-DOF SO-101) can't meet a full 6D pose — relax orientation
  const rotWeight = jointNames.length < 6 ? 0.3 : 1;
  const duration = keyframes.length ? Math.max(...keyframes.map((k) => k.t)) : 0;

  /** Tool frame + calibration for one chain, cached (mesh scans aren't free). */
  const toolFor = useCallback(
    (chainIdx: number): { tool: ToolFrame; calib: GripperCalibration | null } => {
      const chain = chains[chainIdx] ?? null;
      const grips = robot && chain ? chainGrippers(robot, chain) : [];
      let calib = calibByChainRef.current.get(chainIdx);
      if (calib === undefined && robot) {
        calib = calibrateGripper(robot, grips.length ? grips : findGripperJoints(robot));
        calibByChainRef.current.set(chainIdx, calib);
      }
      let tool = toolByChainRef.current.get(chainIdx);
      if (!tool && robot) {
        tool = findToolFrame(robot, chains.length > 1 && grips.length ? grips : undefined);
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
        toolByChainRef.current.set(chainIdx, tool);
      }
      return { tool: tool ?? { link: "", offset: [0, 0, 0], axis: [0, 0, 1] }, calib: calib ?? null };
    },
    [robot, chains],
  );

  useEffect(() => {
    setKeyframes([]);
    setJointTracks([]);
    playheadRef.current = 0;
    toolByChainRef.current = new Map();
    calibByChainRef.current = new Map();
    planSceneRef.current = null;
    restRef.current = null;
    carriedRef.current = false;
    grabbedRef.current = false;
    segmentsRef.current = [];
    walkSegsRef.current = [];
    planJobRef.current = null;
    trackRecRef.current = null;
    baseRef.current = { x: 0, z: 0, yaw: 0 };
    programBaseRef.current = { x: 0, z: 0, yaw: 0 };
    setPlayhead(0);
    setIsPlaying(false);
    setError(null);
    // objects/targets are placed relative to the previous robot's workspace — clear them
    setObjects([]);
    setTargets([]);
    setSelectedId(null);
    const found = robot ? findKinematicChains(robot) : [];
    setChains(found);
    setActiveChainIdx(0);
    setAutoHand(true);
    setSurfaceY(0);
    if (robot) {
      applyBasePose(robot, { x: 0, z: 0, yaw: 0 });
      // the load-time pose is the reference posture every plan starts from (replanning
      // from playback leftovers accumulated drift — the "second run breaks" bug)
      const ready: Record<string, number> = {};
      for (const [n, j] of Object.entries(robot.joints)) {
        const t = (j as { jointType?: string }).jointType;
        if (t === "revolute" || t === "continuous" || t === "prismatic") {
          ready[n] = j.angle as number;
        }
      }
      fullReadyRef.current = ready;
    } else {
      fullReadyRef.current = null;
    }
  }, [robot]);

  // tall robots (humanoids) work on a table: support surface goes under the hand.
  // computed on demand — the viewer's ground-lift and mesh streaming settle late
  const refreshSurface = useCallback((): number => {
    if (!robot) return 0;
    const { tool } = toolFor(activeChainIdx);
    if (!tool.link) return 0;
    robot.updateMatrixWorld(true);
    const tcp = toolWorldPosition(robot, tool.link, tool.offset);
    const sy = tcp.y > 0.5 ? Math.min(0.8, +(tcp.y - 0.22).toFixed(2)) : 0;
    surfaceYRef.current = sy;
    setSurfaceY(sy);
    return sy;
  }, [robot, activeChainIdx, toolFor]);

  useEffect(() => {
    if (!robot) return;
    const t = setTimeout(refreshSurface, 450); // after the viewer's ground re-fit (~200ms)
    return () => clearTimeout(t);
  }, [robot, refreshSurface]);

  // any scene edit invalidates the planned program — playing a trajectory that was
  // planned for the OLD cube/target positions is exactly the "second run breaks" bug
  const invalidate = useCallback(() => {
    setKeyframes((k) => (k.length ? [] : k));
    setJointTracks((t) => (t.length ? [] : t));
    setIsPlaying((pl) => (pl ? false : pl));
    playheadRef.current = 0;
    setPlayhead((ph) => (ph !== 0 ? 0 : ph));
    carriedRef.current = false;
    grabbedRef.current = false;
    segmentsRef.current = [];
    walkSegsRef.current = [];
    planJobRef.current = null;
    trackRecRef.current = null;
  }, []);

  const sceneFingerprint = useCallback(
    () =>
      JSON.stringify({
        c: objectsRef.current.map((o) => o.position.map((v) => Math.round(v * 1000))),
        t: targetsRef.current.map((o) => o.position.map((v) => Math.round(v * 1000))),
      }),
    [],
  );

  /** Base pose the program prescribes for time t (walk windows interpolate). */
  const baseAt = useCallback((t: number): BasePose => {
    let pose = programBaseRef.current;
    for (const w of walkSegsRef.current) {
      if (t >= w.t1) pose = w.to;
      else if (t >= w.t0) {
        const u = smooth((t - w.t0) / Math.max(1e-6, w.t1 - w.t0));
        return {
          x: w.from.x + (w.to.x - w.from.x) * u,
          z: w.from.z + (w.to.z - w.from.z) * u,
          yaw: lerpAngle(w.from.yaw, w.to.yaw, u),
        };
      } else break;
    }
    return pose;
  }, []);

  const inWalk = useCallback((t: number): boolean => {
    return walkSegsRef.current.some((w) => t >= w.t0 && t < w.t1);
  }, []);

  /** Retarget keyframes to joint frames, walking the base along its program track. */
  const solveTracks = useCallback(
    (kfs: Keyframe[], fps: number, names: string[], tool: ToolFrame, rest: number[]) => {
      if (!robot) return [];
      const samples = sampleTrajectory(kfs, fps, smooth);
      const frames: { t: number; joints: Record<string, number>; gripper: number }[] = [];
      let lastJoints: Record<string, number> | null = null;
      for (const s of samples) {
        applyBasePose(robot, baseAt(s.t));
        if (inWalk(s.t) && lastJoints) {
          frames.push({ t: s.t, joints: { ...lastJoints }, gripper: s.gripper });
          continue;
        }
        solveIK(robot, tool.link, names, s.position, s.quaternion, {
          iterations: 20,
          lambda: 0.06,
          tcpOffset: tool.offset,
          restPose: rest,
          restGain: names.length >= 8 ? 0.06 : 0.02,
          limits: softLimitsRef.current,
          rotWeight,
          floorY: surfaceYRef.current + 0.008,
        });
        const joints: Record<string, number> = {};
        for (const n of names) joints[n] = robot.joints[n]!.angle as number;
        lastJoints = joints;
        frames.push({ t: s.t, joints, gripper: s.gripper });
      }
      return frames;
    },
    [robot, baseAt, inWalk, rotWeight],
  );

  /**
   * Plan the NEXT unplanned cube and append its segment to the program. Returns false
   * when the job aborted (error set). Skipped/unreachable cubes are noted and passed
   * over; once the queue is exhausted the return-home keyframe closes the program.
   */
  const planNextSegment = useCallback((): boolean => {
    const st = planJobRef.current;
    if (!robot || !st || st.done) return false;
    const { names, rest, chainIdx } = st;
    const { tool, calib } = toolFor(chainIdx);

    /** Can the arm hit p (position-only check) from the current base? Restores joints. */
    const canReach = (pnt: [number, number, number]): boolean => {
      const saved = names.map((n) => robot.joints[n]!.angle as number);
      solveIK(robot, tool.link, names, pnt, [0, 0, 0, 1], {
        iterations: 40,
        lambda: 0.06,
        tcpOffset: tool.offset,
        restPose: rest,
        restGain: 0.02,
        rotWeight: 0.1, // position feasibility only
      });
      const err = toolWorldPosition(robot, tool.link, tool.offset).distanceTo(new Vector3(...pnt));
      names.forEach((n, k) => robot.setJointValue(n, saved[k]!));
      robot.updateMatrixWorld(true);
      return err < 0.06;
    };
    const planOnce = (cubePos: [number, number, number]) => {
      const base = {
        candidates: 36,
        // tight: the cube is only 2.5cm half-width — a slack TCP tolerance IS a
        // finger inside the cube. Plans that can't land this close get rejected.
        reachThreshold: 0.015,
        approachWeight: 2.0,
        tcpOffset: tool.offset,
        toolAxis: tool.axis,
        clearance: surfaceYRef.current + CUBE_HALF,
        restPose: rest,
        restGain: names.length >= 8 ? 0.06 : 0.03,
        limits: softLimitsRef.current,
        openAxis: calib?.openAxis,
      };
      // two-pass: steep top-down first for EVERY arm (slanted approaches sweep a
      // finger through the cube on the way down); only if nothing steep is reachable
      // relax the cone — better a slanted grasp than a refusal
      return (
        planGrasp(robot, tool.link, names, cubePos, { ...base, minApproachY: 0.6 }) ??
        planGrasp(robot, tool.link, names, cubePos, { ...base, minApproachY: 0.25 })
      );
    };
    const fail = (msg: string): boolean => {
      setError(msg);
      setKeyframes([]);
      planJobRef.current = null;
      return false;
    };

    while (st.idx < st.queue.length) {
      const i = st.idx;
      st.idx++;
      const cube = objectsRef.current.find((o) => o.id === st.queue[i]);
      if (!cube) continue; // deleted mid-program
      const tgts = targetsRef.current;
      const target = tgts.length ? tgts[i % tgts.length]!.position : null;
      const plan = planOnce(cube.position);
      if (!plan) {
        if (st.queue.length === 1)
          return fail("Target unreachable (outside the arm's workspace) — drag the cube closer and retry");
        st.skipped.push(i + 1);
        continue;
      }
      if (target) {
        const tDist = Math.hypot(target[0] - baseRef.current.x, target[2] - baseRef.current.z);
        const placeOk = tDist <= st.anchorR * 1.35 && canReach([target[0], target[1] + 0.05, target[2]]);
        if (!placeOk) {
          if (st.queue.length === 1)
            return fail("Place point outside the arm's workspace — drag the target closer and retry");
          st.skipped.push(i + 1);
          continue;
        }
      }
      // segment eases in from wherever the arm ACTUALLY is right now (playback pose)
      robot.updateMatrixWorld(true);
      const hp = toolWorldPosition(robot, tool.link, tool.offset);
      const hq = robot.links[tool.link]?.getWorldQuaternion(new Quaternion());
      let seg = buildGraspTrajectory(plan, {
        homePos: [hp.x, hp.y, hp.z],
        homeQuat: hq ? [hq.x, hq.y, hq.z, hq.w] : undefined,
      });
      if (target) {
        const last = seg[seg.length - 1]!;
        const placeStart = last.t;
        const q = carryQuat(plan.graspQuat, cube.position, target);
        const above: [number, number, number] = [
          target[0],
          Math.max(target[1], surfaceYRef.current + CUBE_HALF) + 0.18,
          target[2],
        ];
        // carry the cube by its center (TCP = cube center): hover it just above its rest height
        const at: [number, number, number] = [
          target[0],
          Math.max(target[1], surfaceYRef.current + CUBE_HALF) + 0.005,
          target[2],
        ];
        seg = [
          ...seg,
          { t: placeStart + 1.2, position: above, quaternion: q, gripper: 1 },
          { t: placeStart + 2.0, position: at, quaternion: q, gripper: 1 },
          { t: placeStart + 2.6, position: at, quaternion: q, gripper: 0 },
          { t: placeStart + 3.4, position: above, quaternion: q, gripper: 0 },
        ];
      }
      const tOffset = st.endT;
      const segShifted = seg.map((k) => ({ ...k, t: k.t + tOffset }));
      const endT = segShifted[segShifted.length - 1]!.t;
      segmentsRef.current = [...segmentsRef.current, { cubeId: cube.id, start: tOffset, end: endT }];
      st.endT = endT + 0.4;
      setKeyframes((prev) => [...prev, ...segShifted]);
      if (st.skipped.length) setError(`Cube(s) ${st.skipped.join(", ")} out of workspace, skipped`);
      return true;
    }

    // queue exhausted — close out the program with the return-home keyframe
    st.done = true;
    if (segmentsRef.current.length === 0)
      return fail("No cube is reachable (all outside the workspace) — drag them closer and retry");
    setKeyframes((prev) =>
      prev.length
        ? [
            ...prev,
            {
              t: prev[prev.length - 1]!.t + 1.5,
              position: st.home0.position,
              quaternion: st.home0.quaternion,
              gripper: 0,
            },
          ]
        : prev,
    );
    const skipNote = st.skipped.length ? `Cube(s) ${st.skipped.join(", ")} out of workspace, skipped` : null;
    setError([st.handNote, skipNote].filter(Boolean).join("; ") || null);
    return true;
  }, [robot, toolFor]);

  /**
   * Start an incremental pick-and-place program: cube i goes to target[i % n].
   * With several gripper-bearing chains (humanoid hands), the closer hand is chosen
   * automatically. Only the FIRST segment is planned here — the rest stream in from
   * the playback loop in real time, one cube at a time.
   */
  const generateGrasp = useCallback(() => {
    if (!robot) return;
    const cubes = objectsRef.current;
    if (cubes.length === 0) {
      setError("Add a cube in the Scene panel first (or pick a preset from the Scene menu)");
      return;
    }

    // reset the whole body and base to the load-time baseline
    if (fullReadyRef.current) {
      for (const [n, v] of Object.entries(fullReadyRef.current)) robot.setJointValue(n, v);
    }
    applyBasePose(robot, baseRef.current);

    // ---- hand selection: nearest gripper-bearing chain to the first cube ----
    const gripChainIdxs = chains.map((c, i) => ({ c, i })).filter((x) => x.c.gripperJoints.length > 0);
    let chainIdx = activeChainIdx;
    if (autoHand && gripChainIdxs.length > 1) {
      let best = Infinity;
      for (const { i } of gripChainIdxs) {
        const { tool } = toolFor(i);
        if (!tool.link) continue;
        const p = toolWorldPosition(robot, tool.link, tool.offset);
        const d = Math.hypot(p.x - cubes[0]!.position[0], p.z - cubes[0]!.position[2]);
        if (d < best) {
          best = d;
          chainIdx = i;
        }
      }
    } else if (gripChainIdxs.length > 0 && !(chains[chainIdx]?.gripperJoints.length ?? 0)) {
      chainIdx = gripChainIdxs[0]!.i;
    }
    const chain = chains[chainIdx] ?? null;
    const names = chain ? chain.joints : jointNames;
    const grips = chain && robot ? chainGrippers(robot, chain) : gripperJoints;
    if (grips.length === 0) {
      setError("This robot has no gripper joints — grasping needs a gripper-equipped robot (e.g. Franka Panda / SO-101)");
      return;
    }
    setActiveChainIdx(chainIdx);

    const { tool, calib } = toolFor(chainIdx);
    if (calib) applyGripperCalibrated(robot, calib, 0, CUBE_SIZE); // start truly open
    const rest = names.map((n) => robot.joints[n]!.angle as number);
    restRef.current = rest;
    // humanoid chains include the torso — pin it near upright (soft ±0.35 rad around
    // ready) so IK can never fold the body or sling the arm behind the back
    const softLimits: Record<string, { lower: number; upper: number }> = {};
    if (names.length >= 8) {
      for (let k = 0; k < names.length - 7; k++) {
        softLimits[names[k]!] = { lower: rest[k]! - 0.35, upper: rest[k]! + 0.35 };
      }
    }
    softLimitsRef.current = softLimits;

    // capture the program-start home pose + reach bound, then stream segments
    programBaseRef.current = { ...baseRef.current };
    robot.updateMatrixWorld(true);
    const hp0 = toolWorldPosition(robot, tool.link, tool.offset);
    const hq0 = robot.links[tool.link]?.getWorldQuaternion(new Quaternion());
    const home0: Keyframe = {
      t: 0,
      position: [hp0.x, hp0.y, hp0.z],
      quaternion: hq0 ? [hq0.x, hq0.y, hq0.z, hq0.w] : [0, 0, 0, 1],
      gripper: 0,
    };
    const anchorR = Math.hypot(hp0.x - baseRef.current.x, hp0.z - baseRef.current.z);
    const handNote =
      autoHand && gripChainIdxs.length > 1 ? `Auto-selected ${chains[chainIdx]!.name}` : null;
    planJobRef.current = {
      queue: cubes.map((c) => c.id),
      idx: 0,
      chainIdx,
      names,
      rest,
      anchorR,
      home0,
      endT: 0,
      skipped: [],
      handNote,
      done: false,
    };
    segmentsRef.current = [];
    walkSegsRef.current = [];
    planSceneRef.current = sceneFingerprint();
    setKeyframes([]);
    // timeline curves get recorded live at 20 Hz while the program plays
    setJointTracks([]);
    trackRecRef.current = {
      nextT: 0,
      tracks: [...names.map((n) => ({ name: n, values: [] as number[] })), { name: "gripper", values: [] as number[] }],
    };
    setError(null);
    if (!planNextSegment()) return; // nothing reachable — error already set
    playheadRef.current = 0;
    setPlayhead(0);
    setIsPlaying(true); // auto-play so the user sees the motion
  }, [
    robot,
    chains,
    activeChainIdx,
    autoHand,
    jointNames,
    gripperJoints,
    toolFor,
    sceneFingerprint,
    planNextSegment,
  ]);

  useEffect(() => {
    if (!isPlaying || !robot || keyframes.length < 2) return;
    const { tool, calib } = toolFor(activeChainIdx);
    if (!tool.link) return;
    // close only far enough to touch the cube faces — no finger/cube clipping
    const closure = closureForWidth(gripperJoints, CUBE_SIZE);
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1); // clamp big gaps (planning stall, tab refocus)
      last = now;
      let nt = playheadRef.current + dt;
      let ended = false;
      if (nt >= duration) {
        const job = planJobRef.current;
        if (job && !job.done) {
          // real-time planning: the playhead caught up with what's planned — extend
          // the program by ONE segment (single-cube latency, absorbed by the dt clamp)
          planNextSegment();
          nt = duration; // keep rolling; the effect re-arms with the longer program
        } else if (loop) nt = 0;
        else {
          nt = duration;
          ended = true;
        }
      }
      playheadRef.current = nt;
      applyBasePose(robot, baseAt(nt));
      const walking = inWalk(nt);
      const pose = interpolateKeyframes(keyframes, nt);
      if (!walking) {
        solveIK(robot, tool.link, jointNames, pose.position, pose.quaternion, {
          iterations: 30,
          lambda: 0.06,
          tcpOffset: tool.offset,
          restPose: restRef.current ?? undefined,
          restGain: jointNames.length >= 8 ? 0.06 : 0.02,
          limits: softLimitsRef.current,
          rotWeight,
          floorY: surfaceYRef.current + 0.008,
        });
        if (calib) applyGripperCalibrated(robot, calib, pose.gripper, CUBE_SIZE);
        else applyGripper(robot, gripperJoints, pose.gripper * closure);
      }
      // kinematic attach with a grasp gate: closing only grabs the segment's cube when
      // the TCP is actually AT it — no more telekinesis when the approach missed
      const seg = segmentsRef.current.find((s) => nt >= s.start && s.end + 0.5 >= nt);
      const cubeId = seg?.cubeId;
      const closed = pose.gripper > 0.5;
      const tcp = toolWorldPosition(robot, tool.link, tool.offset);
      if (closed && !carriedRef.current && cubeId && !walking) {
        const c = objectsRef.current.find((o) => o.id === cubeId);
        grabbedRef.current =
          !!c && Math.hypot(tcp.x - c.position[0], tcp.y - c.position[1], tcp.z - c.position[2]) <= GRASP_RADIUS;
      }
      if (grabbedRef.current && cubeId) {
        if (closed) {
          // carry: the cube rides the bite point
          setObjects((o) =>
            o.map((x) => (x.id === cubeId ? { ...x, position: [tcp.x, tcp.y, tcp.z] as [number, number, number] } : x)),
          );
        } else if (carriedRef.current) {
          // release: the cube settles on the support surface right under the bite point
          setObjects((o) =>
            o.map((x) =>
              x.id === cubeId
                ? { ...x, position: [tcp.x, surfaceYRef.current + CUBE_HALF, tcp.z] as [number, number, number] }
                : x,
            ),
          );
          grabbedRef.current = false;
        }
      }
      carriedRef.current = closed && !walking ? true : closed;
      // live-record the timeline curves at 20 Hz as the program plays through
      const rec = trackRecRef.current;
      if (rec && nt >= rec.nextT) {
        for (const tr of rec.tracks)
          tr.values.push(tr.name === "gripper" ? pose.gripper : ((robot.joints[tr.name]?.angle as number) ?? 0));
        rec.nextT += 0.05;
        // flush in batches — a setState per frame would thrash the timeline panel
        if (ended || rec.tracks[0]!.values.length % 8 === 0)
          setJointTracks(rec.tracks.map((t) => ({ name: t.name, values: [...t.values] })));
      }
      setPlayhead(nt);
      if (ended) {
        setIsPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [
    isPlaying,
    robot,
    keyframes,
    duration,
    jointNames,
    gripperJoints,
    loop,
    rotWeight,
    activeChainIdx,
    toolFor,
    baseAt,
    inWalk,
    planNextSegment,
  ]);

  const exportEpisode = useCallback(() => {
    if (!robot || keyframes.length < 2) return;
    const { tool } = toolFor(activeChainIdx);
    if (!tool.link) return;
    applyBasePose(robot, programBaseRef.current);
    const rest = restRef.current ?? jointNames.map((n) => robot.joints[n]!.angle as number);
    const jointFrames = solveTracks(keyframes, 30, jointNames, tool, rest);
    const frames = toLeRobotFrames(jointFrames, jointNames, 0);
    downloadJSON("grasp_episode_0.json", { jointNames: [...jointNames, "gripper"], frames });
  }, [robot, jointNames, keyframes, activeChainIdx, toolFor, solveTracks]);

  /** Replace the whole scene (preset scenes / prompt-generated scenes). */
  const applyScene = useCallback(
    (scene: SceneSpec) => {
      invalidate();
      refreshSurface();
      setObjects(
        scene.cubes.map((c) => ({
          id: `cube-${idRef.current++}`,
          position: [c.x, surfaceYRef.current + CUBE_HALF, c.z] as [number, number, number],
          color: c.color,
        })),
      );
      setTargets(
        scene.targets.map((t) => ({ id: `target-${idRef.current++}`, position: [t.x, surfaceYRef.current + 0.026, t.z] })),
      );
      setSelectedId(null);
      setError(null);
    },
    [invalidate, refreshSurface],
  );

  /** Anchor + radius of the robot's comfortable workspace (for scene generators). */
  const workspaceAnchor = useCallback((): { x: number; z: number; radius: number } => {
    const { tool } = toolFor(activeChainIdx);
    const [x, z] = spawnSpot(robot, tool.link ? tool : null, 0);
    const arm = Math.max(0.18, Math.hypot(x, z) * 1.15);
    return { x, z, radius: arm };
  }, [robot, activeChainIdx, toolFor]);

  return {
    objects,
    targets,
    selectedId,
    setSelectedId,
    addCube: () => {
      invalidate();
      refreshSurface();
      const id = `cube-${idRef.current++}`;
      const { tool } = toolFor(activeChainIdx);
      const [bx, bz] = spawnSpot(robot, tool.link ? tool : null, 0);
      setObjects((o) => {
        const n = o.length;
        // on the support surface under the gripper's hover point — inside the workspace
        return [
          ...o,
          {
            id,
            position: [bx + (n % 3) * 0.09, surfaceYRef.current + CUBE_HALF, bz + Math.floor(n / 3) * 0.09] as [
              number,
              number,
              number,
            ],
          },
        ];
      });
      setSelectedId(id);
    },
    addTarget: () => {
      invalidate();
      refreshSurface();
      const id = `target-${idRef.current++}`;
      const { tool } = toolFor(activeChainIdx);
      setTargets((t) => {
        // same radius as the cube spawn, fanned around the base per target
        const [tx, tz] = spawnSpot(robot, tool.link ? tool : null, 0.55 + t.length * 0.3);
        return [...t, { id, position: [tx, surfaceYRef.current + 0.026, tz] as [number, number, number] }];
      });
      setSelectedId(id);
    },
    removeObject: (id: string) => {
      invalidate();
      setObjects((o) => o.filter((x) => x.id !== id));
    },
    removeTarget: (id: string) => {
      invalidate();
      setTargets((t) => t.filter((x) => x.id !== id));
    },
    moveObject: (id: string, p: [number, number, number]) => {
      invalidate();
      setObjects((o) => o.map((x) => (x.id === id ? { ...x, position: p } : x)));
    },
    moveTarget: (id: string, p: [number, number, number]) => {
      invalidate();
      setTargets((t) => t.map((x) => (x.id === id ? { ...x, position: p } : x)));
    },
    applyScene,
    workspaceAnchor,
    chains,
    activeChainIdx,
    autoHand,
    setActiveChain: (idx: number) => {
      invalidate();
      setObjects([]);
      setTargets([]);
      setSelectedId(null);
      if (idx < 0) {
        setAutoHand(true);
      } else {
        setAutoHand(false);
        setActiveChainIdx(idx);
      }
    },
    surfaceY,
    generateGrasp,
    keyframes,
    error,
    playhead,
    duration,
    isPlaying,
    play: () => {
      const stale = planSceneRef.current !== null && planSceneRef.current !== sceneFingerprint();
      if (keyframes.length < 2 || stale) {
        generateGrasp(); // auto-(re)plan — the program always targets where the cubes ARE
        return;
      }
      if (playheadRef.current >= duration) playheadRef.current = 0; // restart if parked at the end
      setPlayhead(playheadRef.current);
      setIsPlaying(true);
    },
    pause: () => setIsPlaying(false),
    stop: () => {
      setIsPlaying(false);
      playheadRef.current = 0;
      setPlayhead(0);
      if (robot) applyBasePose(robot, programBaseRef.current);
    },
    loop,
    toggleLoop: () => setLoop((l) => !l),
    isRecording,
    toggleRecord: () => setIsRecording((v) => !v),
    jointTracks,
    exportEpisode,
  };
}
