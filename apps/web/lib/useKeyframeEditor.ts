"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Object3D, Vector3, Quaternion } from "three";
import {
  findEndEffectorLink,
  solveIK,
  interpolateKeyframes,
  sampleTrajectory,
  retargetTrajectory,
  toLeRobotFrames,
  type JointInfo,
  type URDFRobot,
  type Keyframe,
} from "@urdflow/urdf-web";
import { downloadJSON } from "./download";

export function useKeyframeEditor(robot: URDFRobot | null, model: JointInfo[]) {
  const gizmoTarget = useRef(new Object3D());
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [playhead, setPlayhead] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [gripper, setGripper] = useState(0);

  const eeLink = useMemo(() => (robot ? findEndEffectorLink(robot) : ""), [robot]);
  const jointNames = useMemo(() => model.map((m) => m.name), [model]);
  const duration = keyframes.length ? Math.max(...keyframes.map((k) => k.t)) : 0;

  // place gizmo at the robot's current EE pose when a robot loads
  useEffect(() => {
    if (!robot) return;
    robot.updateMatrixWorld(true);
    const link = robot.links[eeLink];
    if (!link) return;
    gizmoTarget.current.position.copy(link.getWorldPosition(new Vector3()));
    gizmoTarget.current.quaternion.copy(link.getWorldQuaternion(new Quaternion()));
    setKeyframes([]);
    setPlayhead(0);
    setIsPlaying(false);
  }, [robot, eeLink]);

  // gizmo dragged → real-time IK so the robot follows the target (所见即所得)
  const onGizmoMove = useCallback(() => {
    if (!robot) return;
    const p = gizmoTarget.current.position;
    const q = gizmoTarget.current.quaternion;
    solveIK(robot, eeLink, jointNames, [p.x, p.y, p.z], [q.x, q.y, q.z, q.w], { iterations: 20, lambda: 0.08 });
  }, [robot, eeLink, jointNames]);

  const addKeyframe = useCallback(() => {
    const p = gizmoTarget.current.position;
    const q = gizmoTarget.current.quaternion;
    setKeyframes((kfs) => {
      const t = kfs.length ? Math.max(...kfs.map((k) => k.t)) + 1 : 0;
      return [...kfs, { t, position: [p.x, p.y, p.z], quaternion: [q.x, q.y, q.z, q.w], gripper }];
    });
  }, [gripper]);

  const removeKeyframe = useCallback(
    (i: number) => setKeyframes((kfs) => kfs.filter((_, idx) => idx !== i)),
    [],
  );

  // playback: RAF advances playhead, interpolate → IK → drive twin
  useEffect(() => {
    if (!isPlaying || !robot || keyframes.length < 2) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setPlayhead((t) => {
        const nt = t + dt;
        const pose = interpolateKeyframes(keyframes, Math.min(nt, duration));
        solveIK(robot, eeLink, jointNames, pose.position, pose.quaternion, { iterations: 20, lambda: 0.08 });
        if (nt >= duration) {
          setIsPlaying(false);
          return duration;
        }
        return nt;
      });
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [isPlaying, robot, keyframes, duration, eeLink, jointNames]);

  const exportEpisode = useCallback(() => {
    if (!robot || keyframes.length < 2) return;
    const samples = sampleTrajectory(keyframes, 30);
    const jointFrames = retargetTrajectory(robot, eeLink, jointNames, samples, { iterations: 30, lambda: 0.06 });
    const frames = toLeRobotFrames(jointFrames, jointNames, 0);
    downloadJSON("episode_0.json", { jointNames: [...jointNames, "gripper"], frames });
  }, [robot, eeLink, jointNames, keyframes]);

  return {
    gizmoTarget: gizmoTarget.current,
    onGizmoMove,
    keyframes,
    addKeyframe,
    removeKeyframe,
    playhead,
    duration,
    isPlaying,
    play: () => setIsPlaying(true),
    pause: () => setIsPlaying(false),
    gripper,
    setGripper,
    exportEpisode,
  };
}
