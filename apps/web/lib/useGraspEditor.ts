"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Vector3, Quaternion } from "three";
import {
  findEndEffectorLink,
  planGrasp,
  buildGraspTrajectory,
  interpolateKeyframes,
  sampleTrajectory,
  retargetTrajectory,
  toLeRobotFrames,
  solveIK,
  findGripperJoints,
  applyGripper,
  type GripperJoint,
  type JointInfo,
  type URDFRobot,
  type Keyframe,
} from "@urdflow/urdf-web";
import { downloadJSON } from "./download";

const smooth = (u: number) => u * u * (3 - 2 * u);

export function useGraspEditor(robot: URDFRobot | null, model: JointInfo[]) {
  const [objects, setObjects] = useState<{ id: string; position: [number, number, number] }[]>([]);
  const [target, setTarget] = useState<[number, number, number] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const idRef = useRef(0);
  const playheadRef = useRef(0);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [jointTracks, setJointTracks] = useState<{ name: string; values: number[] }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const eeLink = useMemo(() => (robot ? findEndEffectorLink(robot) : ""), [robot]);
  const jointNames = useMemo(() => model.map((m) => m.name), [model]);
  const gripperJoints = useMemo<GripperJoint[]>(() => (robot ? findGripperJoints(robot) : []), [robot]);
  const duration = keyframes.length ? Math.max(...keyframes.map((k) => k.t)) : 0;

  useEffect(() => {
    setKeyframes([]);
    setJointTracks([]);
    playheadRef.current = 0;
    setPlayhead(0);
    setIsPlaying(false);
    setError(null);
  }, [robot]);

  const generateGrasp = useCallback(() => {
    if (!robot) return;
    const cube = objects[0];
    if (!cube) {
      setError("先在左侧 Scene 添加一个正方体");
      return;
    }
    if (gripperJoints.length === 0) {
      setError("当前机型没有夹爪(如 UR5),抓取需要带夹爪的机型(如 Franka Panda)");
      return;
    }
    const plan = planGrasp(robot, eeLink, jointNames, cube.position, {
      candidates: 36,
      reachThreshold: 0.05,
      approachWeight: 1.2, // softer top-down so it can reach out & slant-grasp ground objects
    });
    if (!plan) {
      setError("目标不可达(超出工作空间),把正方体拖近一点再试");
      setKeyframes([]);
      return;
    }
    setError(null);
    // read current EE pose as the home start so playback eases in (no jump)
    robot.updateMatrixWorld(true);
    const ee = robot.links[eeLink];
    const hp = ee?.getWorldPosition(new Vector3());
    const hq = ee?.getWorldQuaternion(new Quaternion());
    let kfs = buildGraspTrajectory(plan, {
      homePos: hp ? [hp.x, hp.y, hp.z] : undefined,
      homeQuat: hq ? [hq.x, hq.y, hq.z, hq.w] : undefined,
    });
    // with a target placement, continue into a place: move → lower → release → retreat
    if (target) {
      const last = kfs[kfs.length - 1]!;
      const q = plan.graspQuat;
      const above: [number, number, number] = [target[0], target[1] + 0.18, target[2]];
      const at: [number, number, number] = [target[0], target[1] + 0.03, target[2]];
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
    const jf = retargetTrajectory(robot, eeLink, jointNames, curveSamples, { iterations: 20, lambda: 0.06 });
    const tracks = jointNames.map((n) => ({ name: n, values: jf.map((f) => f.joints[n] ?? 0) }));
    tracks.push({ name: "gripper", values: jf.map((f) => f.gripper) });
    setJointTracks(tracks);
    playheadRef.current = 0;
    setPlayhead(0);
    setIsPlaying(true); // auto-play so the user sees the motion
  }, [robot, eeLink, jointNames, objects, target, gripperJoints]);

  useEffect(() => {
    if (!isPlaying || !robot || keyframes.length < 2) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
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
      solveIK(robot, eeLink, jointNames, pose.position, pose.quaternion, { iterations: 30, lambda: 0.06 });
      applyGripper(robot, gripperJoints, pose.gripper);
      // kinematic attach: the grasped cube rides the gripper while it's closed
      if (pose.gripper > 0.5) {
        robot.updateMatrixWorld(true);
        const ee = robot.links[eeLink];
        if (ee) {
          const p = ee.getWorldPosition(new Vector3());
          setObjects((o) =>
            o.length ? [{ ...o[0]!, position: [p.x, p.y, p.z] as [number, number, number] }, ...o.slice(1)] : o,
          );
        }
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
  }, [isPlaying, robot, keyframes, duration, eeLink, jointNames, gripperJoints, loop]);

  const exportEpisode = useCallback(() => {
    if (!robot || keyframes.length < 2) return;
    const samples = sampleTrajectory(keyframes, 30, smooth);
    const jointFrames = retargetTrajectory(robot, eeLink, jointNames, samples, { iterations: 30, lambda: 0.06 });
    const frames = toLeRobotFrames(jointFrames, jointNames, 0);
    downloadJSON("grasp_episode_0.json", { jointNames: [...jointNames, "gripper"], frames });
  }, [robot, eeLink, jointNames, keyframes]);

  return {
    objects,
    target,
    selectedId,
    setSelectedId,
    addCube: () => {
      const id = `cube-${idRef.current++}`;
      setObjects((o) => {
        const n = o.length;
        // on the table top (~y=0.225) in front of the base — comfortable top-down reach
        return [
          ...o,
          { id, position: [0.42 + (n % 3) * 0.09, 0.025, -0.08 + Math.floor(n / 3) * 0.09] as [number, number, number] },
        ];
      });
      setSelectedId(id);
    },
    addTarget: () => {
      setTarget([0.5, 0.026, 0.16]);
      setSelectedId("target");
    },
    removeObject: (id: string) => setObjects((o) => o.filter((x) => x.id !== id)),
    removeTarget: () => setTarget(null),
    moveObject: (id: string, p: [number, number, number]) =>
      setObjects((o) => o.map((x) => (x.id === id ? { ...x, position: p } : x))),
    moveTarget: (p: [number, number, number]) => setTarget(p),
    generateGrasp,
    keyframes,
    error,
    playhead,
    duration,
    isPlaying,
    play: () => {
      if (keyframes.length < 2) {
        generateGrasp(); // auto-plan + auto-play — no manual generate step
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
