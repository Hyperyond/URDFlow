"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Quaternion } from "three";
import {
  findToolFrame,
  planGrasp,
  buildGraspTrajectory,
  carryQuat,
  interpolateKeyframes,
  sampleTrajectory,
  retargetTrajectory,
  toLeRobotFrames,
  solveIK,
  toolWorldPosition,
  findGripperJoints,
  applyGripper,
  closureForWidth,
  calibrateGripper,
  applyGripperCalibrated,
  type GripperCalibration,
  type ToolFrame,
  type GripperJoint,
  type JointInfo,
  type URDFRobot,
  type Keyframe,
} from "@urdflow/urdf-web";
import { downloadJSON } from "./download";

const smooth = (u: number) => u * u * (3 - 2 * u);

/** Side length of the scene cubes (must match RobotViewer's boxGeometry). */
export const CUBE_SIZE = 0.05;
const CUBE_HALF = CUBE_SIZE / 2;
/** The gripper only actually grabs when the TCP is this close to the cube center. */
const GRASP_RADIUS = 0.06;

/**
 * Ground spot under the gripper's current hover point, pulled slightly inward and
 * optionally swung around the base — lands inside the robot's workspace for any model.
 */
function spawnSpot(
  robot: URDFRobot | null,
  toolRef: { current: ToolFrame | null },
  swing: number,
): [number, number] {
  let x = 0.42;
  let z = -0.08;
  if (robot) {
    const tool = toolRef.current ?? findToolFrame(robot);
    toolRef.current = tool;
    const p = toolWorldPosition(robot, tool.link, tool.offset);
    x = p.x * 0.9;
    z = p.z * 0.9;
    const r = Math.hypot(x, z);
    if (r < 0.12) {
      // gripper hovers over the base — push out to a workable radius along the same azimuth
      const s = r < 1e-6 ? 0 : 0.18 / r;
      x = r < 1e-6 ? 0.18 : x * s;
      z = r < 1e-6 ? 0 : z * s;
    }
  }
  if (swing !== 0) {
    const c = Math.cos(swing);
    const s = Math.sin(swing);
    const nx = x * c - z * s;
    const nz = x * s + z * c;
    return [nx, nz];
  }
  return [x, z];
}

export function useGraspEditor(robot: URDFRobot | null, model: JointInfo[]) {
  const [objects, setObjects] = useState<{ id: string; position: [number, number, number] }[]>([]);
  const objectsRef = useRef(objects);
  objectsRef.current = objects;
  const [target, setTarget] = useState<[number, number, number] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const idRef = useRef(0);
  const playheadRef = useRef(0);
  const toolRef = useRef<ToolFrame | null>(null);
  const calibRef = useRef<GripperCalibration | null>(null);
  const readyRef = useRef<number[] | null>(null);
  const restRef = useRef<number[] | null>(null);
  const carriedRef = useRef(false);
  const grabbedRef = useRef(false);
  const planCubeRef = useRef<[number, number, number] | null>(null);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [jointTracks, setJointTracks] = useState<{ name: string; values: number[] }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const gripperJoints = useMemo<GripperJoint[]>(() => (robot ? findGripperJoints(robot) : []), [robot]);
  // arm joints only — gripper joints are driven separately, not used to reach the target
  const jointNames = useMemo(() => {
    const grip = new Set(gripperJoints.map((g) => g.name));
    return model.map((m) => m.name).filter((n) => !grip.has(n));
  }, [model, gripperJoints]);
  // under-actuated arms (e.g. 5-DOF SO-101) can't meet a full 6D pose — relax orientation
  const rotWeight = jointNames.length < 6 ? 0.3 : 1;
  const duration = keyframes.length ? Math.max(...keyframes.map((k) => k.t)) : 0;

  useEffect(() => {
    setKeyframes([]);
    setJointTracks([]);
    playheadRef.current = 0;
    toolRef.current = null;
    calibRef.current = null;
    planCubeRef.current = null;
    restRef.current = null;
    carriedRef.current = false;
    grabbedRef.current = false;
    setPlayhead(0);
    setIsPlaying(false);
    setError(null);
    // objects/target are placed relative to the previous robot's workspace — clear them
    setObjects([]);
    setTarget(null);
    setSelectedId(null);
    // the load-time pose is the reference posture every plan starts from (replanning
    // from playback leftovers accumulated drift — the "second run breaks" bug)
    readyRef.current = robot ? jointNames.map((n) => robot.joints[n]!.angle as number) : null;
  }, [robot, jointNames]);

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
  }, []);

  const generateGrasp = useCallback(() => {
    if (!robot) return;
    const cube = objects[0];
    if (!cube) {
      setError("先在左侧 Scene 添加一个正方体");
      return;
    }
    if (gripperJoints.length === 0) {
      setError("当前机型没有夹爪关节,抓取需要带夹爪的机型(如 Franka Panda / SO-101)");
      return;
    }
    // every plan starts from the same ready baseline — replanning from playback
    // leftovers drifted a little more on each run until the motion broke
    if (readyRef.current) {
      jointNames.forEach((n, i) => robot.setJointValue(n, readyRef.current![i]!));
      robot.updateMatrixWorld(true);
    }
    // tool frame + gripper calibration are computed lazily here (meshes have finished
    // streaming by now); the calibrated bite point beats any name-based guess
    const calib = calibRef.current ?? calibrateGripper(robot, gripperJoints);
    calibRef.current = calib;
    let tool = findToolFrame(robot);
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
      applyGripperCalibrated(robot, calib, 0, CUBE_SIZE); // start truly open (PiPER's axes lie)
    }
    toolRef.current = tool;
    const rest = readyRef.current ?? jointNames.map((n) => robot.joints[n]!.angle as number);
    restRef.current = rest;
    planCubeRef.current = [...cube.position] as [number, number, number];
    const plan = planGrasp(robot, tool.link, jointNames, cube.position, {
      candidates: 36,
      reachThreshold: 0.05,
      approachWeight: 2.0,
      tcpOffset: tool.offset,
      toolAxis: tool.axis,
      minApproachY: 0.25, // come from above the horizon — never through the floor
      clearance: CUBE_HALF,
      restPose: rest,
    });
    if (!plan) {
      setError("目标不可达(超出工作空间),把正方体拖近一点再试");
      setKeyframes([]);
      return;
    }
    setError(null);
    // read the current TCP pose as the home start so playback eases in (no jump)
    robot.updateMatrixWorld(true);
    const hp = toolWorldPosition(robot, tool.link, tool.offset);
    const hq = robot.links[tool.link]?.getWorldQuaternion(new Quaternion());
    let kfs = buildGraspTrajectory(plan, {
      homePos: [hp.x, hp.y, hp.z],
      homeQuat: hq ? [hq.x, hq.y, hq.z, hq.w] : undefined,
    });
    // with a target placement, continue into a place: move → lower → release → retreat.
    // the carry orientation swings with the base azimuth so wrist-roll limits never bind
    if (target) {
      const last = kfs[kfs.length - 1]!;
      const q = carryQuat(plan.graspQuat, cube.position, target);
      const above: [number, number, number] = [target[0], Math.max(target[1], CUBE_HALF) + 0.18, target[2]];
      // carry the cube by its center (TCP = cube center): hover it just above its rest height
      const at: [number, number, number] = [target[0], Math.max(target[1], CUBE_HALF) + 0.005, target[2]];
      kfs = [
        ...kfs,
        { t: last.t + 1.2, position: above, quaternion: q, gripper: 1 },
        { t: last.t + 2.0, position: at, quaternion: q, gripper: 1 },
        { t: last.t + 2.6, position: at, quaternion: q, gripper: 0 },
        { t: last.t + 3.4, position: above, quaternion: q, gripper: 0 },
      ];
    }
    // return to the home pose at the end (arm goes back to rest)
    const home0 = kfs[0]!;
    kfs = [
      ...kfs,
      { t: kfs[kfs.length - 1]!.t + 1.5, position: home0.position, quaternion: home0.quaternion, gripper: 0 },
    ];
    setKeyframes(kfs);
    // joint-space tracks for the timeline curves (retarget a low-fps sampling)
    const curveSamples = sampleTrajectory(kfs, 20, smooth);
    const jf = retargetTrajectory(robot, tool.link, jointNames, curveSamples, {
      iterations: 20,
      lambda: 0.06,
      tcpOffset: tool.offset,
      restPose: rest,
      restGain: 0.02,
      rotWeight,
      floorY: 0.008,
    });
    const tracks = jointNames.map((n) => ({ name: n, values: jf.map((f) => f.joints[n] ?? 0) }));
    tracks.push({ name: "gripper", values: jf.map((f) => f.gripper) });
    setJointTracks(tracks);
    playheadRef.current = 0;
    setPlayhead(0);
    setIsPlaying(true); // auto-play so the user sees the motion
  }, [robot, jointNames, objects, target, gripperJoints, rotWeight]);

  useEffect(() => {
    if (!isPlaying || !robot || keyframes.length < 2) return;
    const tool = toolRef.current ?? findToolFrame(robot);
    toolRef.current = tool;
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
        if (loop) nt = 0;
        else {
          nt = duration;
          ended = true;
        }
      }
      playheadRef.current = nt;
      const pose = interpolateKeyframes(keyframes, nt);
      solveIK(robot, tool.link, jointNames, pose.position, pose.quaternion, {
        iterations: 30,
        lambda: 0.06,
        tcpOffset: tool.offset,
        restPose: restRef.current ?? undefined,
        restGain: 0.02,
        rotWeight,
      });
      const calib = calibRef.current;
      if (calib) applyGripperCalibrated(robot, calib, pose.gripper, CUBE_SIZE);
      else applyGripper(robot, gripperJoints, pose.gripper * closure);
      // kinematic attach with a grasp gate: closing only grabs the cube when the TCP
      // is actually AT the cube — no more telekinesis when the approach missed
      const closed = pose.gripper > 0.5;
      const tcp = toolWorldPosition(robot, tool.link, tool.offset);
      if (closed && !carriedRef.current) {
        const c = objectsRef.current[0];
        grabbedRef.current =
          !!c && Math.hypot(tcp.x - c.position[0], tcp.y - c.position[1], tcp.z - c.position[2]) <= GRASP_RADIUS;
      }
      if (grabbedRef.current) {
        if (closed) {
          // carry: the cube rides the bite point
          setObjects((o) =>
            o.length ? [{ ...o[0]!, position: [tcp.x, tcp.y, tcp.z] as [number, number, number] }, ...o.slice(1)] : o,
          );
        } else if (carriedRef.current) {
          // release: the cube settles on the ground right under the bite point
          setObjects((o) =>
            o.length ? [{ ...o[0]!, position: [tcp.x, CUBE_HALF, tcp.z] as [number, number, number] }, ...o.slice(1)] : o,
          );
          grabbedRef.current = false;
        }
      }
      carriedRef.current = closed;
      setPlayhead(nt);
      if (ended) {
        setIsPlaying(false);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, robot, keyframes, duration, jointNames, gripperJoints, loop, rotWeight]);

  const exportEpisode = useCallback(() => {
    if (!robot || keyframes.length < 2) return;
    const tool = toolRef.current ?? findToolFrame(robot);
    const samples = sampleTrajectory(keyframes, 30, smooth);
    const jointFrames = retargetTrajectory(robot, tool.link, jointNames, samples, {
      iterations: 30,
      lambda: 0.06,
      tcpOffset: tool.offset,
      restPose: restRef.current ?? undefined,
      restGain: 0.02,
      rotWeight,
      floorY: 0.008,
    });
    const frames = toLeRobotFrames(jointFrames, jointNames, 0);
    downloadJSON("grasp_episode_0.json", { jointNames: [...jointNames, "gripper"], frames });
  }, [robot, jointNames, keyframes, rotWeight]);

  return {
    objects,
    target,
    selectedId,
    setSelectedId,
    addCube: () => {
      invalidate();
      const id = `cube-${idRef.current++}`;
      const [bx, bz] = spawnSpot(robot, toolRef, 0);
      setObjects((o) => {
        const n = o.length;
        // on the ground under the gripper's hover point — inside any robot's workspace
        return [
          ...o,
          { id, position: [bx + (n % 3) * 0.09, CUBE_HALF, bz + Math.floor(n / 3) * 0.09] as [number, number, number] },
        ];
      });
      setSelectedId(id);
    },
    addTarget: () => {
      invalidate();
      // same radius as the cube spawn, swung ~30° around the base
      const [tx, tz] = spawnSpot(robot, toolRef, 0.55);
      setTarget([tx, 0.026, tz]);
      setSelectedId("target");
    },
    removeObject: (id: string) => {
      invalidate();
      setObjects((o) => o.filter((x) => x.id !== id));
    },
    removeTarget: () => {
      invalidate();
      setTarget(null);
    },
    moveObject: (id: string, p: [number, number, number]) => {
      invalidate();
      setObjects((o) => o.map((x) => (x.id === id ? { ...x, position: p } : x)));
    },
    moveTarget: (p: [number, number, number]) => {
      invalidate();
      setTarget(p);
    },
    generateGrasp,
    keyframes,
    error,
    playhead,
    duration,
    isPlaying,
    play: () => {
      const cube = objectsRef.current[0];
      const planned = planCubeRef.current;
      const stale =
        !!cube &&
        !!planned &&
        Math.hypot(
          cube.position[0] - planned[0],
          cube.position[1] - planned[1],
          cube.position[2] - planned[2],
        ) > 0.01;
      if (keyframes.length < 2 || stale) {
        generateGrasp(); // auto-(re)plan — the program always targets where the cube IS
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
    },
    loop,
    toggleLoop: () => setLoop((l) => !l),
    isRecording,
    toggleRecord: () => setIsRecording((v) => !v),
    jointTracks,
    exportEpisode,
  };
}
