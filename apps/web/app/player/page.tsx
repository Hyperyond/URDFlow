"use client";

/**
 * Trajectory player — stage 1 of the data-QC workbench.
 * Loads retargeted motion clips (OmniRetarget .npz: base pose + joints
 * [+ object pose], Z-up world) and replays them on the URDF model in the
 * browser. Bundled samples come from the MIT-licensed OmniRetarget dataset;
 * any .npz in the same layout can be dropped onto the page.
 */

import { useCallback, useEffect, useRef, useState } from "react";
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
  type Object3D,
} from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { Group } from "three";
import {
  loadURDFFromURL,
  loadURDFFromString,
  parseNpz,
  motionFromNpz,
  fitJointCount,
  sampleAt,
  type MotionClip,
  type URDFRobot,
} from "@urdflow/urdf-web";

/**
 * Load a scene-asset URDF. Drake-convention files weld to an implicit "world"
 * link that plain URDF (and urdf-loader) doesn't define — inject an empty one.
 */
async function loadSceneURDF(url: string): Promise<URDFRobot> {
  let text = await fetch(url).then((r) => r.text());
  if (/link="world"/.test(text) && !/<link\s+name="world"/.test(text)) {
    text = text.replace(/<robot([^>]*)>/, '<robot$1><link name="world"/>');
  }
  // mesh refs are relative to the URDF's directory
  const base = url.slice(0, url.lastIndexOf("/") + 1);
  text = text.replace(/filename="(?!https?:|\/|package:)([^"]+)"/g, `filename="${base}$1"`);
  return loadURDFFromString(text, {
    // urdf-loader's default mesh loader has no OBJ support
    loadMeshCb: (path, _manager, done) => {
      if (/\.obj$/i.test(path)) {
        fetch(path)
          .then((r) => r.text())
          .then((objText) => done(new OBJLoader().parse(objText)))
          .catch((e) => {
            console.warn(`scene mesh failed: ${path}`, e);
            done(new Group());
          });
      } else {
        console.warn(`scene mesh type unsupported: ${path}`);
        done(new Group());
      }
    },
  });
}

interface Sample {
  id: string;
  name: string;
  npz: string;
  /** optional scene asset: a URDF welded to the world or following the object pose */
  scene?: { urdf: string; attach: "world" | "object" };
}

const SAMPLES: Sample[] = [
  {
    id: "climb_00",
    name: "G1 爬越地形",
    npz: "/datasets/omniretarget/climb_00.npz",
    scene: { urdf: "/datasets/omniretarget/climb_00_terrain.urdf", attach: "world" },
  },
  {
    id: "chair_carry",
    name: "G1 搬运椅子",
    npz: "/datasets/omniretarget/chair_carry.npz",
    scene: { urdf: "/datasets/omniretarget/chair_scaled_1.2.urdf", attach: "object" },
  },
];

const ROBOT_URDF = "/robots/g1/g1.urdf";
const SPEEDS = [0.25, 0.5, 1, 2];

/** movable (non-fixed, non-mimic) joint names in URDF declaration order */
function movableJoints(robot: URDFRobot): string[] {
  return Object.entries(robot.joints)
    .filter(([, j]) => {
      const t = (j as { jointType?: string }).jointType;
      const mimic = (j as { mimicJoint?: unknown }).mimicJoint;
      return t !== "fixed" && !mimic;
    })
    .map(([name]) => name);
}

export default function PlayerPage() {
  const mountRef = useRef<HTMLDivElement>(null);
  const [status, setStatus] = useState("加载中…");
  const [sampleId, setSampleId] = useState(SAMPLES[0]!.id);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [clipName, setClipName] = useState("");
  const [dragOver, setDragOver] = useState(false);

  // refs shared with the render loop
  const clipRef = useRef<MotionClip | null>(null);
  const jointNamesRef = useRef<string[]>([]);
  const robotRef = useRef<URDFRobot | null>(null);
  const objectRef = useRef<Object3D | null>(null);
  const sceneAssetRef = useRef<Object3D | null>(null);
  const sceneRef = useRef<Scene | null>(null);
  const timeRef = useRef(0);
  const playingRef = useRef(true);
  const speedRef = useRef(1);
  const seekRef = useRef<number | null>(null);

  playingRef.current = playing;
  speedRef.current = speed;

  const installClip = useCallback((clip: MotionClip, name: string) => {
    const robot = robotRef.current;
    if (!robot) return;
    const movable = jointNamesRef.current;
    // resolve layout: robot-only first, else robot+object (trailing 7 = object pose)
    const nRobotOnly = clip.dim - 7;
    const nWithObject = clip.dim - 14;
    let fitted: MotionClip;
    if (nRobotOnly <= movable.length) fitted = fitJointCount(clip, nRobotOnly);
    else if (nWithObject > 0 && nWithObject <= movable.length) fitted = fitJointCount(clip, nWithObject);
    else throw new Error(`轨迹宽度 ${clip.dim} 与机器人 ${movable.length} 个关节不匹配`);

    clipRef.current = fitted;
    timeRef.current = 0;
    setDuration(fitted.duration);
    setTime(0);
    setClipName(`${name} · ${fitted.frames} 帧 · ${fitted.fps}fps · ${fitted.duration.toFixed(1)}s${fitted.hasObject ? " · 含物体" : ""}`);
    setStatus("");
  }, []);

  const loadSeqRef = useRef(0);
  const loadSample = useCallback(
    async (sample: Sample) => {
      const seq = ++loadSeqRef.current;
      setStatus(`加载 ${sample.name}…`);
      const npzBuf = await fetch(sample.npz).then((r) => r.arrayBuffer());
      const clip = motionFromNpz(await parseNpz(npzBuf));
      const asset = sample.scene ? await loadSceneURDF(sample.scene.urdf) : null;
      if (seq !== loadSeqRef.current) return; // a newer load superseded this one
      // swap scene asset
      if (sceneAssetRef.current) {
        sceneRef.current?.remove(sceneAssetRef.current);
        sceneAssetRef.current = null;
        objectRef.current = null;
      }
      if (asset) {
        sceneRef.current?.add(asset);
        sceneAssetRef.current = asset;
        if (sample.scene!.attach === "object") objectRef.current = asset;
      }
      installClip(clip, sample.name);
    },
    [installClip],
  );

  // ---- three.js scene + render loop (mounted once) ----
  useEffect(() => {
    let alive = true;
    let raf = 0;
    let renderer: WebGLRenderer | null = null;
    let controls: OrbitControls | null = null;
    let last = performance.now();

    (async () => {
      const mount = mountRef.current;
      if (!mount) return;

      const scene = new Scene();
      sceneRef.current = scene;
      const camera = new PerspectiveCamera(45, mount.clientWidth / mount.clientHeight, 0.05, 80);
      camera.position.set(3.0, 2.0, 3.0);
      renderer = new WebGLRenderer({ antialias: true });
      renderer.setSize(mount.clientWidth, mount.clientHeight);
      renderer.setClearColor(0x10141a);
      renderer.toneMapping = ACESFilmicToneMapping;
      mount.appendChild(renderer.domElement);
      controls = new OrbitControls(camera, renderer.domElement);
      controls.target.set(0, 0.7, 0);
      scene.add(new HemisphereLight(0xffffff, 0x3a4250, 1.0));
      const sun = new DirectionalLight(0xfff2e0, 1.3);
      sun.position.set(5, 8, 4);
      scene.add(sun);
      const ground = new Mesh(
        new PlaneGeometry(40, 40),
        new MeshStandardMaterial({ color: 0x1d232c, roughness: 0.95 }),
      );
      ground.rotation.x = -Math.PI / 2;
      scene.add(ground);
      scene.add(new GridHelper(40, 80, 0x39424f, 0x262d37));

      setStatus("加载机器人模型…");
      const robot = await loadURDFFromURL(ROBOT_URDF);
      if (!alive) return;
      robotRef.current = robot;
      jointNamesRef.current = movableJoints(robot);
      scene.add(robot);

      await loadSample(SAMPLES[0]!);
      if (!alive) return;

      const qx90 = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
      const tmpQ = new Quaternion();
      const follow = new Vector3();

      const tick = (now: number) => {
        if (!alive) return;
        const dt = Math.min(0.1, (now - last) / 1000);
        last = now;

        const clip = clipRef.current;
        if (clip) {
          if (seekRef.current !== null) {
            timeRef.current = seekRef.current;
            seekRef.current = null;
          } else if (playingRef.current) {
            timeRef.current += dt * speedRef.current;
            if (timeRef.current > clip.duration) timeRef.current = 0; // loop
          }
          setTime(timeRef.current);

          const f = sampleAt(clip, timeRef.current);
          const robot = robotRef.current!;
          // Z-up world → three Y-up: p=(x,z,-y), q = Rx(-90°)∘q_zup (quat stored wxyz)
          robot.position.set(f.base.pos[0], f.base.pos[2], -f.base.pos[1]);
          tmpQ.set(f.base.quat[1], f.base.quat[2], f.base.quat[3], f.base.quat[0]);
          robot.quaternion.copy(qx90.clone().multiply(tmpQ));
          const names = jointNamesRef.current;
          for (let j = 0; j < clip.jointCount; j++) {
            robot.setJointValue(names[j]!, f.joints[j]!);
          }
          if (f.object && objectRef.current) {
            const o = objectRef.current;
            o.position.set(f.object.pos[0], f.object.pos[2], -f.object.pos[1]);
            tmpQ.set(f.object.quat[1], f.object.quat[2], f.object.quat[3], f.object.quat[0]);
            o.quaternion.copy(qx90.clone().multiply(tmpQ));
          }
          // gentle camera follow
          follow.set(robot.position.x, 0.7, robot.position.z);
          if (controls) {
            camera.position.add(follow.clone().sub(controls.target).multiplyScalar(0.05));
            controls.target.lerp(follow, 0.05);
          }
        }

        controls?.update();
        renderer!.render(scene, camera);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    })().catch((e) => {
      console.error(e);
      setStatus(`加载失败: ${e instanceof Error ? e.message : String(e)}`);
    });

    const onResize = () => {
      const mount = mountRef.current;
      if (!mount || !renderer) return;
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    return () => {
      alive = false;
      window.removeEventListener("resize", onResize);
      cancelAnimationFrame(raf);
      controls?.dispose();
      renderer?.dispose();
      if (renderer?.domElement.parentElement) renderer.domElement.parentElement.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- drop a .npz file ----
  const onDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (!file || !file.name.endsWith(".npz")) {
        setStatus("请拖入 .npz 轨迹文件");
        return;
      }
      try {
        setStatus(`解析 ${file.name}…`);
        loadSeqRef.current++; // supersede any in-flight sample load
        // dropped clips have no bundled scene asset
        if (sceneAssetRef.current) {
          sceneRef.current?.remove(sceneAssetRef.current);
          sceneAssetRef.current = null;
          objectRef.current = null;
        }
        const clip = motionFromNpz(await parseNpz(await file.arrayBuffer()));
        installClip(clip, file.name);
      } catch (err) {
        setStatus(`解析失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [installClip],
  );

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

  return (
    <div
      className="relative h-screen w-screen bg-[#10141a]"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={onDrop}
    >
      <div ref={mountRef} className="h-full w-full" />

      {dragOver && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center border-4 border-dashed border-cyan-400/70 bg-cyan-400/10 text-xl font-semibold text-cyan-200">
          松开以加载 .npz 轨迹
        </div>
      )}

      {/* top bar */}
      <div className="absolute left-3 top-3 flex flex-col gap-2 text-xs">
        <div className="rounded border border-white/10 bg-black/60 px-3 py-2 text-zinc-200">
          <div className="font-semibold">轨迹播放器 · URDFlow 数据工作台</div>
          <div className="mt-1 text-zinc-400">
            {status || clipName || "拖入 .npz 文件,或选择内置样本"}
          </div>
          <div className="mt-0.5 text-[10px] text-zinc-500">
            内置样本来自 OmniRetarget Dataset(MIT)· 拖入任意同格式 .npz 即可回放
          </div>
        </div>
        <div className="flex gap-2">
          {SAMPLES.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setSampleId(s.id);
                loadSample(s).catch((e) => setStatus(`加载失败: ${e.message}`));
              }}
              className={`rounded px-3 py-1.5 ${
                sampleId === s.id ? "bg-cyan-600/90 text-white" : "bg-white/10 text-zinc-200 hover:bg-white/20"
              }`}
            >
              {s.name}
            </button>
          ))}
          <a href="/" className="rounded bg-white/10 px-3 py-1.5 text-zinc-200 hover:bg-white/20">
            返回编辑器
          </a>
        </div>
      </div>

      {/* transport bar */}
      <div className="absolute bottom-4 left-1/2 flex w-[min(720px,92vw)] -translate-x-1/2 items-center gap-3 rounded-xl border border-white/10 bg-black/70 px-4 py-3 text-sm text-zinc-200 backdrop-blur">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-600 text-white hover:bg-cyan-500"
          aria-label={playing ? "暂停" : "播放"}
        >
          {playing ? "⏸" : "▶"}
        </button>
        <span className="w-14 text-right tabular-nums text-zinc-400">{fmt(time)}</span>
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={0.01}
          value={Math.min(time, duration)}
          onChange={(e) => {
            seekRef.current = Number(e.target.value);
          }}
          className="flex-1 accent-cyan-500"
        />
        <span className="w-14 tabular-nums text-zinc-400">{fmt(duration)}</span>
        <div className="flex gap-1">
          {SPEEDS.map((sp) => (
            <button
              key={sp}
              onClick={() => setSpeed(sp)}
              className={`rounded px-2 py-1 text-xs ${
                speed === sp ? "bg-cyan-600 text-white" : "bg-white/10 text-zinc-300 hover:bg-white/20"
              }`}
            >
              {sp}x
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
