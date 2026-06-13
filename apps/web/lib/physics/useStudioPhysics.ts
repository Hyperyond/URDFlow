"use client";

/**
 * Physics-backed playback: compiles the current editor world (URDF + cubes +
 * ground) to MJCF, boots MuJoCo WASM in a worker, and keeps the three.js scene
 * synchronized with the dynamics. Two sync modes:
 *  - idle: the hook's own rAF loop applies sim state (arm holds its targets,
 *    cubes obey gravity);
 *  - playback: useGraspEditor calls drive(robot) each tick — IK results become
 *    position-actuator targets, then the sim pose overwrites the render pose,
 *    so what you SEE is what physics says, not what IK wished for.
 *
 * Editor frame is three.js Y-up; MuJoCo is Z-up. Convert at this boundary:
 *   three (x,y,z) → mj (x,−z,y);  mj (x,y,z) → three (x,z,−y).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Quaternion } from "three";
import { urdfToMJCF, type MJCFBox, type URDFRobot } from "@urdflow/urdf-web";
import { collectMeshAssets, collectRobotFiles, type RobotSourceRef } from "./robotFiles";

const CUBE_HALF = 0.025; // matches the editor's 0.05 boxGeometry
const CUBE_MASS = 0.05; // kg — a light plastic cube

export interface PhysicsDrive {
  active: boolean;
  /** Per playback tick: robot's joint pose → ctrl targets, then sim pose → robot. */
  drive: (robot: URDFRobot) => void;
  /** Sim clock (seconds). Playback paces the playhead with THIS, not wall time —
   *  on machines where mj_step runs slower than real time the reference would
   *  otherwise race ahead and the gripper would close before the arm arrives. */
  simTime: () => number;
}

export type PhysicsStatus = "off" | "booting" | "ready" | "error";

export interface StudioPhysics {
  status: PhysicsStatus;
  error: string | null;
  /** Contact count from the last published sim frame (-1 = bindings hide it). */
  ncon: number;
  /** Hand to useGraspEditor so playback routes through the sim. */
  driveRef: React.RefObject<PhysicsDrive | null>;
  reset: () => void;
}

// frame change F = Rot_x(-90°): v_three = F · v_mj
const F_QUAT = new Quaternion(-Math.SQRT1_2, 0, 0, Math.SQRT1_2);
const F_INV = F_QUAT.clone().invert();

export function useStudioPhysics(args: {
  enabled: boolean;
  robot: URDFRobot | null;
  source: RobotSourceRef | null;
  objects: { id: string; position: [number, number, number] }[];
  isPlaying: boolean;
  onCubePose: (id: string, pos: [number, number, number], quat: [number, number, number, number]) => void;
}): StudioPhysics {
  const { enabled, robot, source, isPlaying, onCubePose } = args;
  const [status, setStatus] = useState<PhysicsStatus>("off");
  const [error, setError] = useState<string | null>(null);
  const [ncon, setNcon] = useState(-1);

  const workerRef = useRef<Worker | null>(null);
  const sabRef = useRef<Float64Array | null>(null);
  const layoutRef = useRef<{ jointNames: string[]; actuators: string[]; freeBodies: string[] } | null>(null);
  const driveRef = useRef<PhysicsDrive | null>(null);
  const isPlayingRef = useRef(isPlaying);
  isPlayingRef.current = isPlaying;
  const objectsRef = useRef(args.objects);
  objectsRef.current = args.objects;
  const onCubePoseRef = useRef(onCubePose);
  onCubePoseRef.current = onCubePose;

  /** SAB sim state → three robot joints + editor cube poses. */
  const applyState = useCallback(
    (r: URDFRobot) => {
      const sab = sabRef.current;
      const layout = layoutRef.current;
      if (!sab || !layout) return;
      const { jointNames, freeBodies } = layout;
      for (let i = 0; i < jointNames.length; i++) r.setJointValue(jointNames[i]!, sab[1 + i]!);
      const base = 1 + jointNames.length;
      freeBodies.forEach((id, k) => {
        const o = base + 7 * k;
        const pos: [number, number, number] = [sab[o]!, sab[o + 2]!, -sab[o + 1]!]; // mj→three
        const qm = new Quaternion(sab[o + 4]!, sab[o + 5]!, sab[o + 6]!, sab[o + 3]!); // wxyz → three xyzw
        const qt = F_QUAT.clone().multiply(qm).multiply(F_INV);
        onCubePoseRef.current(id, pos, [qt.x, qt.y, qt.z, qt.w]);
      });
      setNcon(sab[base + 7 * freeBodies.length] ?? -1);
    },
    [],
  );

  // boot / teardown — reboots when toggled, robot changes, or cube count changes
  const cubeCount = args.objects.length;
  useEffect(() => {
    if (!enabled || !robot || !source) {
      setStatus("off");
      driveRef.current = null;
      return;
    }
    let alive = true;
    setStatus("booting");
    setError(null);

    (async () => {
      const files = await collectRobotFiles(source);
      const objects: MJCFBox[] = objectsRef.current.map((o) => ({
        name: o.id,
        halfExtents: [CUBE_HALF, CUBE_HALF, CUBE_HALF],
        pos: [o.position[0], -o.position[2], o.position[1]], // three→mj
        mass: CUBE_MASS,
        free: true,
      }));
      const compiled = urdfToMJCF(files.urdfText, { objects });
      if (compiled.warnings.length) console.warn("[physics] MJCF warnings:", compiled.warnings);
      const assets = await collectMeshAssets(compiled.meshes, files);
      if (!alive) return;

      const joints = (robot as unknown as { joints: Record<string, { angle: number }> }).joints;
      const initialQpos = compiled.jointNames.map((n) => joints[n]?.angle ?? 0);
      const initialCtrl = compiled.actuators.map((n) => joints[n]?.angle ?? 0);

      const njoint = compiled.jointNames.length;
      const nfree = compiled.freeBodies.length;
      const sab = new SharedArrayBuffer((1 + njoint + 7 * nfree + 1) * 8);
      sabRef.current = new Float64Array(sab);
      layoutRef.current = compiled;

      const worker = new Worker(new URL("./studio.worker.ts", import.meta.url));
      workerRef.current = worker;
      worker.onerror = (e) => {
        if (!alive) return;
        setStatus("error");
        setError(`worker failed to load: ${e.message ?? "unknown"}`);
        driveRef.current = null;
      };
      worker.onmessage = (e: MessageEvent<{ type: string; message?: string; step?: string }>) => {
        if (!alive) return;
        if (e.data.type === "progress") {
          console.info("[physics] boot:", e.data.step);
        } else if (e.data.type === "ready") {
          setStatus("ready");
          driveRef.current = {
            active: true,
            simTime: () => sabRef.current?.[0] ?? 0,
            drive: (r: URDFRobot) => {
              // IK already wrote target angles into the robot — capture BEFORE applying sim state
              const j = (r as unknown as { joints: Record<string, { angle: number }> }).joints;
              const targets = layoutRef.current!.actuators.map((n) => j[n]?.angle ?? 0);
              if ((window as unknown as { __physDebug?: boolean }).__physDebug) {
                console.info("[physics] ctrl", targets.map((v) => v.toFixed(3)).join(","));
              }
              workerRef.current?.postMessage({ type: "ctrl", targets });
              applyState(r);
            },
          };
        } else if (e.data.type === "error") {
          setStatus("error");
          setError(e.data.message ?? "physics worker failed");
          driveRef.current = null;
        }
      };
      worker.postMessage({ type: "boot", xml: compiled.xml, assets, sab, njoint, nfree, initialQpos, initialCtrl });
    })().catch((e) => {
      if (!alive) return;
      setStatus("error");
      setError(e instanceof Error ? e.message : String(e));
    });

    return () => {
      alive = false;
      driveRef.current = null;
      workerRef.current?.terminate();
      workerRef.current = null;
      sabRef.current = null;
      layoutRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, robot, source, cubeCount, applyState]);

  // idle sync: when not playing, the hook owns applying sim state to the scene
  useEffect(() => {
    if (status !== "ready" || !robot) return;
    let raf = 0;
    const tick = () => {
      if (!isPlayingRef.current) applyState(robot);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [status, robot, applyState]);

  const reset = useCallback(() => workerRef.current?.postMessage({ type: "reset" }), []);

  return { status, error, ncon, driveRef, reset };
}
