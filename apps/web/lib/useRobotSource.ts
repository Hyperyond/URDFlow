"use client";

import { useCallback, useEffect, useState } from "react";
import {
  loadURDFFromURL,
  loadURDFFromFiles,
  getJointModel,
  naturalRestPose,
  findGripperJoints,
  applyGripper,
  type JointInfo,
  type URDFRobot,
  type URDFFileEntry,
} from "@urdflow/urdf-web";
import { PRESETS, type RobotPreset } from "./presets";

type Source =
  | { kind: "preset"; url: string; label: string; readyPose?: Record<string, number> }
  | { kind: "files"; entries: URDFFileEntry[]; label: string };

/**
 * Put the arm into a natural ready pose: preset-provided joints win, everything else
 * falls back to the naturalRestPose heuristic (which also fixes joints whose URDF
 * limits exclude 0, like the Panda elbow). The gripper starts open.
 */
function applyReadyPose(robot: URDFRobot, pose?: Record<string, number>) {
  const gripper = findGripperJoints(robot);
  const grip = new Set(gripper.map((g) => g.name));
  const arm = getJointModel(robot)
    .map((m) => m.name)
    .filter((n) => !grip.has(n));
  const fallback = naturalRestPose(robot, arm);
  arm.forEach((n, i) => robot.setJointValue(n, pose?.[n] ?? fallback[i]!));
  applyGripper(robot, gripper, 0);
  robot.updateMatrixWorld(true);
}

/** Owns robot loading (preset URL or uploaded files). FK/driving lives in useMechatronics. */
export function useRobotSource() {
  const [source, setSource] = useState<Source>({
    kind: "preset",
    url: PRESETS[0]!.url,
    label: PRESETS[0]!.name,
    readyPose: PRESETS[0]!.readyPose,
  });
  const [robot, setRobot] = useState<URDFRobot | null>(null);
  const [model, setModel] = useState<JointInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let alive = true;
    setRobot(null);
    setModel([]);
    setError(null);
    setLoading(true);
    setProgress(0);
    const onProgress = (loaded: number, total: number) => {
      if (alive && total > 0) setProgress(loaded / total);
    };
    const p =
      source.kind === "preset"
        ? loadURDFFromURL(source.url, { onProgress })
        : loadURDFFromFiles(source.entries, { onProgress });
    p.then((r) => {
      if (!alive) return;
      applyReadyPose(r, source.kind === "preset" ? source.readyPose : undefined);
      setRobot(r);
      setModel(getJointModel(r));
      setLoading(false);
      setProgress(1);
    }).catch((e) => {
      if (!alive) return;
      setError(e instanceof Error ? e : new Error(String(e)));
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [source]);

  const loadPreset = useCallback(
    (p: RobotPreset) => setSource({ kind: "preset", url: p.url, label: p.name, readyPose: p.readyPose }),
    [],
  );
  const loadFiles = useCallback(
    (entries: URDFFileEntry[], label: string) => setSource({ kind: "files", entries, label }),
    [],
  );

  return { source, robot, model, loading, progress, error, loadPreset, loadFiles };
}
