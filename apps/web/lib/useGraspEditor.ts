"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
  const [boxPosition, setBoxPosition] = useState<[number, number, number]>([0.3, 0.2, 0.3]);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loop, setLoop] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const eeLink = useMemo(() => (robot ? findEndEffectorLink(robot) : ""), [robot]);
  const jointNames = useMemo(() => model.map((m) => m.name), [model]);
  const gripperJoints = useMemo<GripperJoint[]>(() => (robot ? findGripperJoints(robot) : []), [robot]);
  const duration = keyframes.length ? Math.max(...keyframes.map((k) => k.t)) : 0;

  useEffect(() => {
    setKeyframes([]);
    setPlayhead(0);
    setIsPlaying(false);
    setError(null);
  }, [robot]);

  const generateGrasp = useCallback(() => {
    if (!robot) return;
    const plan = planGrasp(robot, eeLink, jointNames, boxPosition, { candidates: 32, reachThreshold: 0.04 });
    if (!plan) {
      setError("目标不可达(超出工作空间),把方块拖近一点再试");
      setKeyframes([]);
      return;
    }
    setError(null);
    // read current EE pose as the home start so playback eases in (no jump)
    robot.updateMatrixWorld(true);
    const ee = robot.links[eeLink];
    const hp = ee?.getWorldPosition(new Vector3());
    const hq = ee?.getWorldQuaternion(new Quaternion());
    const kfs = buildGraspTrajectory(plan, {
      homePos: hp ? [hp.x, hp.y, hp.z] : undefined,
      homeQuat: hq ? [hq.x, hq.y, hq.z, hq.w] : undefined,
    });
    setKeyframes(kfs);
    setPlayhead(0);
    setIsPlaying(true); // auto-play so the user sees the motion
  }, [robot, eeLink, jointNames, boxPosition]);

  useEffect(() => {
    if (!isPlaying || !robot || keyframes.length < 2) return;
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPlayhead((t) => {
        const nt = t + dt;
        const pose = interpolateKeyframes(keyframes, Math.min(nt, duration));
        solveIK(robot, eeLink, jointNames, pose.position, pose.quaternion, { iterations: 20, lambda: 0.08 });
        applyGripper(robot, gripperJoints, pose.gripper);
        if (nt >= duration) {
          if (loop) return 0; // restart, keep playing
          setIsPlaying(false);
          return duration;
        }
        return nt;
      });
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
    boxPosition,
    setBoxPosition,
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
      setPlayhead((t) => (t >= duration ? 0 : t)); // restart if parked at the end
      setIsPlaying(true);
    },
    pause: () => setIsPlaying(false),
    stop: () => {
      setIsPlaying(false);
      setPlayhead(0);
    },
    loop,
    toggleLoop: () => setLoop((l) => !l),
    isRecording,
    toggleRecord: () => setIsRecording((v) => !v),
    exportEpisode,
  };
}
