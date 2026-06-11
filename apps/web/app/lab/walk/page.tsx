"use client";

/**
 * Physics-locomotion spike (P1): Unitree G1 WALKING under real physics in the
 * browser. MuJoCo (official WASM, pthread build) runs inside a Web Worker — its
 * blocking FS/compile calls deadlock the main thread by design — and publishes
 * qpos through a SharedArrayBuffer (we are crossOriginIsolated for the pthread
 * pool anyway). The worker also runs unitree_rl_gym's pre-trained LSTM policy
 * (hand-written forward pass, weights extracted from motion.pt) at 50 Hz against
 * the deploy-config PD law. Rendering drives our existing URDF model from shared
 * state; buttons/WASD set the velocity command (vx, vy, yaw rate).
 */

import { useEffect, useRef, useState } from "react";
import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  HemisphereLight,
  DirectionalLight,
  GridHelper,
  Mesh,
  PlaneGeometry,
  MeshStandardMaterial,
  Quaternion,
  Vector3,
  ACESFilmicToneMapping,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { loadURDFFromURL, type URDFRobot } from "@urdflow/urdf-web";

const MJCF_DIR = "/robots/g1/mjcf";
const TIMESTEP = 0.004; // matches g1_mjx.xml

export default function WalkLab() {
  const mountRef = useRef<HTMLDivElement>(null);
  const workerRef = useRef<Worker | null>(null);
  const [status, setStatus] = useState("启动中…");
  const [stats, setStats] = useState("");
  const [cmd, setCmd] = useState<[number, number, number]>([0, 0, 0]);

  const sendCmd = (vx: number, vy: number, wz: number) => {
    setCmd([vx, vy, wz]);
    workerRef.current?.postMessage({ type: "cmd", vx, vy, wz });
  };

  useEffect(() => {
    let alive = true;
    let raf = 0;
    let renderer: WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let worker: Worker | null = null;

    (async () => {
      const mount = mountRef.current;
      if (!mount) return;

      // ---- three.js view (physics owns the state; we render our URDF model) ----
      const scene = new Scene();
      const camera = new PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.05, 50);
      camera.position.set(2.4, 1.6, 2.4);
      renderer = new WebGLRenderer({ antialias: true });
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.setClearColor(0xeef1f4);
      renderer.toneMapping = ACESFilmicToneMapping;
      mount.appendChild(renderer.domElement);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0.7, 0);
      scene.add(new HemisphereLight(0xffffff, 0xcdd2da, 1.0));
      const sun = new DirectionalLight(0xfff6ea, 1.2);
      sun.position.set(5, 8, 4);
      scene.add(sun);
      const ground = new Mesh(new PlaneGeometry(20, 20), new MeshStandardMaterial({ color: 0xd4d7db, roughness: 0.9 }));
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      scene.add(new GridHelper(20, 40, 0xaab0ba, 0xc8ccd2));

      setStatus("加载 URDF 渲染模型…");
      const robot: URDFRobot = await loadURDFFromURL("/robots/g1/g1.urdf");
      if (!alive) return;
      scene.add(robot);

      // ---- fetch the MJCF on the main thread, hand it to the worker ----
      setStatus("加载 G1 物理模型…");
      const [sceneXml, g1XmlRaw] = await Promise.all([
        fetch(`${MJCF_DIR}/scene_mjx.xml`).then((r) => r.text()),
        fetch(`${MJCF_DIR}/g1_mjx.xml`).then((r) => r.text()),
      ]);
      // The MJX model collides with primitives only — every mesh geom is
      // class="visual" and all inertials are explicit. We render via our URDF model,
      // so strip the visual meshes entirely: physics-identical, nothing to fetch,
      // and mj_loadXML stops needing the thread pool for convex-hull builds.
      const g1Xml = g1XmlRaw
        .replace(/^\s*<mesh\b[^>]*\/>\s*$/gm, "")
        .replace(/^\s*<geom\b[^>]*\bmesh="[^"]*"[^>]*\/>\s*$/gm, "");
      // builtin texture generation is a hang suspect in the wasm build — the ground
      // can be a plain-colored plane, we render our own world anyway
      const sceneStripped = sceneXml
        .replace(/<texture\b[\s\S]*?\/>/g, "")
        .replace(/<material\b[\s\S]*?\/>/g, "")
        .replace(/\s*material="[^"]*"/g, "");
      // joint order in the MJCF body tree = qpos layout after the 7-dof free joint
      const jointOrder = [...g1Xml.matchAll(/<joint name="([^"]+)"/g)].map((m) => m[1]!);
      if (!alive) return;

      setStatus("编译模型(Worker 内 MuJoCo)…");
      const sab = new SharedArrayBuffer(8 * (1 + 7 + jointOrder.length));
      const state = new Float64Array(sab);
      worker = new Worker(new URL("./physics.worker.ts", import.meta.url));
      workerRef.current = worker;
      await new Promise<void>((resolve, reject) => {
        worker!.onmessage = (e: MessageEvent<{ type: string; message?: string; step?: string }>) => {
          if (e.data.type === "ready") resolve();
          else if (e.data.type === "error") reject(new Error(e.data.message));
          else if (e.data.type === "progress") setStatus(`Worker: ${e.data.step}…`);
        };
        worker!.postMessage({
          type: "boot",
          sceneXml: sceneStripped,
          g1Xml,
          assets: [],
          sab,
          timestep: TIMESTEP,
          policyUrl: "/robots/g1/policy/g1_walk_lstm.json",
        });
      });
      if (!alive) return;
      setStatus(""); // running

      // ---- render loop: read shared state, drive the URDF model ----
      const qx90 = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
      const tmpQ = new Quaternion();
      const follow = new Vector3();
      let frames = 0;
      let statT = performance.now();
      const tick = (now: number) => {
        if (!alive) return;
        // MuJoCo Z-up world → three Y-up world: p=(x,z,-y), q = Rx(-90°)∘q_mj
        robot.position.set(state[1]!, state[3]!, -state[2]!);
        tmpQ.set(state[5]!, state[6]!, state[7]!, state[4]!); // wxyz → xyzw
        robot.quaternion.copy(qx90.clone().multiply(tmpQ));
        for (let j = 0; j < jointOrder.length; j++) {
          robot.setJointValue(jointOrder[j]!, state[8 + j]!);
        }
        // camera follows the pelvis so the robot stays in frame while walking
        follow.set(state[1]!, 0.7, -state[2]!);
        if (controls) {
          camera.position.add(follow.clone().sub(controls.target).multiplyScalar(0.08));
          controls.target.lerp(follow, 0.08);
        }
        controls?.update();
        renderer!.render(scene, camera);
        frames++;
        if (now - statT > 500) {
          setStats(
            `渲染 ${Math.round((frames * 1000) / (now - statT))} fps · 物理 ${TIMESTEP * 1000}ms/步 · t=${state[0]!.toFixed(1)}s · 骨盆高 ${state[3]!.toFixed(2)}m · 位置 (${state[1]!.toFixed(2)}, ${state[2]!.toFixed(2)})`,
          );
          frames = 0;
          statT = now;
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })().catch((e) => {
      console.error(e);
      setStatus(`启动失败: ${e instanceof Error ? e.message : String(e)}`);
    });

    // WASD / arrows steer the velocity command, space stops
    const onKey = (e: KeyboardEvent) => {
      const w = workerRef.current;
      if (!w) return;
      const send = (vx: number, vy: number, wz: number) => {
        setCmd([vx, vy, wz]);
        w.postMessage({ type: "cmd", vx, vy, wz });
      };
      switch (e.key.toLowerCase()) {
        case "w": case "arrowup": send(0.5, 0, 0); break;
        case "s": case "arrowdown": send(-0.3, 0, 0); break;
        case "a": case "arrowleft": send(0.3, 0, 0.5); break;
        case "d": case "arrowright": send(0.3, 0, -0.5); break;
        case " ": send(0, 0, 0); e.preventDefault(); break;
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      alive = false;
      window.removeEventListener("keydown", onKey);
      cancelAnimationFrame(raf);
      worker?.terminate();
      controls?.dispose();
      renderer?.dispose();
      if (renderer?.domElement.parentElement) renderer.domElement.parentElement.removeChild(renderer.domElement);
    };
  }, []);

  return (
    <div className="relative h-screen w-screen bg-[#0e1116]">
      <div ref={mountRef} className="h-full w-full" />
      <div className="absolute left-3 top-3 flex flex-col gap-2 text-xs">
        <div className="rounded border border-white/10 bg-black/60 px-3 py-2 text-zinc-200">
          <div className="font-semibold">物理实验台 · Unitree G1 行走(MuJoCo WASM + LSTM 策略)</div>
          <div className="mt-1 text-zinc-400">
            {status || `命令 vx=${cmd[0].toFixed(1)} vy=${cmd[1].toFixed(1)} ω=${cmd[2].toFixed(1)} · WASD/方向键转向,空格停`}
            {stats && <div>{stats}</div>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => sendCmd(0.5, 0, 0)} className="rounded bg-emerald-600/80 px-3 py-1.5 text-white hover:bg-emerald-500">
            前进
          </button>
          <button onClick={() => sendCmd(0, 0, 0)} className="rounded bg-zinc-600/80 px-3 py-1.5 text-white hover:bg-zinc-500">
            停止
          </button>
          <button onClick={() => sendCmd(0.3, 0, 0.5)} className="rounded bg-sky-600/80 px-3 py-1.5 text-white hover:bg-sky-500">
            左转
          </button>
          <button onClick={() => sendCmd(0.3, 0, -0.5)} className="rounded bg-sky-600/80 px-3 py-1.5 text-white hover:bg-sky-500">
            右转
          </button>
          <button
            onClick={() => workerRef.current?.postMessage({ type: "reset" })}
            className="rounded bg-cyan-600/80 px-3 py-1.5 text-white hover:bg-cyan-500"
          >
            重置
          </button>
          <button
            onClick={() => workerRef.current?.postMessage({ type: "push", vx: 0.7, vy: 0.3 })}
            className="rounded bg-amber-600/80 px-3 py-1.5 text-white hover:bg-amber-500"
          >
            推一下
          </button>
          <a href="/" className="rounded bg-white/10 px-3 py-1.5 text-zinc-200 hover:bg-white/20">
            返回编辑器
          </a>
        </div>
      </div>
    </div>
  );
}
