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
  analyzeClip,
  type MotionClip,
  type QCReport,
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

interface SceneAsset {
  urdf: string;
  /** welded to the world, or following the clip's object pose */
  attach: "world" | "object";
}

interface Sample {
  id: string;
  name: string;
  npz: string;
  scenes?: SceneAsset[];
}

const SAMPLES: Sample[] = [
  {
    id: "climb_00",
    name: "G1 terrain climb",
    npz: "/datasets/omniretarget/climb_00.npz",
    scenes: [{ urdf: "/datasets/omniretarget/climb_00/terrain.urdf", attach: "world" }],
  },
  {
    id: "chair_carry",
    name: "G1 chair carry",
    npz: "/datasets/omniretarget/chair_carry.npz",
    scenes: [
      { urdf: "/datasets/omniretarget/chair_scaled_1.2.urdf", attach: "object" },
      { urdf: "/datasets/omniretarget/scene_01/terrain.urdf", attach: "world" },
    ],
  },
];

// OmniRetarget clips were retargeted to the sphere-hand G1 (their visualize.py
// uses g1_29dof_spherehand for terrain/object-terrain subsets)
const ROBOT_URDF = "/robots/g1/g1_29dof_spherehand.urdf";
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
  const [status, setStatus] = useState("Loading…");
  const [sampleId, setSampleId] = useState(SAMPLES[0]!.id);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [clipName, setClipName] = useState("");
  const [dragOver, setDragOver] = useState(false);
  const [report, setReport] = useState<QCReport | null>(null);
  const [qcOpen, setQcOpen] = useState(false);

  // refs shared with the render loop
  const clipRef = useRef<MotionClip | null>(null);
  const jointNamesRef = useRef<string[]>([]);
  const robotRef = useRef<URDFRobot | null>(null);
  const objectRef = useRef<Object3D | null>(null);
  const sceneAssetsRef = useRef<Object3D[]>([]);
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
    else throw new Error(`Trajectory width ${clip.dim} doesn't match the robot's ${movable.length} joints`);

    clipRef.current = fitted;
    timeRef.current = 0;
    setDuration(fitted.duration);
    setTime(0);
    setReport(null);
    setClipName(`${name} · ${fitted.frames} frames · ${fitted.fps}fps · ${fitted.duration.toFixed(1)}s${fitted.hasObject ? " · +object" : ""}`);
    setStatus("");
  }, []);

  const runQC = useCallback(() => {
    const robot = robotRef.current;
    const clip = clipRef.current;
    if (!robot || !clip) return;
    // analyzeClip mutates the robot pose; the render loop re-applies it next frame
    const r = analyzeClip(robot, clip, { jointNames: jointNamesRef.current });
    setReport(r);
    setQcOpen(true);
  }, []);

  const loadSeqRef = useRef(0);
  const clearSceneAssets = useCallback(() => {
    for (const a of sceneAssetsRef.current) sceneRef.current?.remove(a);
    sceneAssetsRef.current = [];
    objectRef.current = null;
  }, []);
  const loadSample = useCallback(
    async (sample: Sample) => {
      const seq = ++loadSeqRef.current;
      setStatus(`Loading ${sample.name}…`);
      const npzBuf = await fetch(sample.npz).then((r) => r.arrayBuffer());
      const clip = motionFromNpz(await parseNpz(npzBuf));
      const assets = await Promise.all((sample.scenes ?? []).map((s) => loadSceneURDF(s.urdf)));
      if (seq !== loadSeqRef.current) return; // a newer load superseded this one
      clearSceneAssets();
      assets.forEach((asset, i) => {
        sceneRef.current?.add(asset);
        sceneAssetsRef.current.push(asset);
        if (sample.scenes![i]!.attach === "object") objectRef.current = asset;
      });
      installClip(clip, sample.name);
    },
    [installClip, clearSceneAssets],
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

      setStatus("Loading robot model…");
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
      setStatus(`Load failed: ${e instanceof Error ? e.message : String(e)}`);
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
        setStatus("Please drop a .npz trajectory file");
        return;
      }
      try {
        setStatus(`Parsing ${file.name}…`);
        loadSeqRef.current++; // supersede any in-flight sample load
        clearSceneAssets(); // dropped clips have no bundled scene asset
        const clip = motionFromNpz(await parseNpz(await file.arrayBuffer()));
        installClip(clip, file.name);
      } catch (err) {
        setStatus(`Parse failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
    [installClip, clearSceneAssets],
  );

  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, "0")}`;

  return (
    <div
      className="relative h-full w-full bg-[#10141a]"
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
          Drop to load a .npz trajectory
        </div>
      )}

      {/* top bar */}
      <div className="absolute left-3 top-3 flex flex-col gap-2 text-xs">
        <div className="rounded border border-white/10 bg-black/60 px-3 py-2 text-zinc-200">
          <div className="font-semibold">Trajectory Player · URDFlow</div>
          <div className="mt-1 text-zinc-400">
            {status || clipName || "Drop a .npz file, or pick a bundled sample"}
          </div>
          <div className="mt-0.5 text-[10px] text-zinc-500">
            Samples from the OmniRetarget Dataset (MIT) · drop any .npz in the same layout to replay
          </div>
        </div>
        <div className="flex gap-2">
          {SAMPLES.map((s) => (
            <button
              key={s.id}
              onClick={() => {
                setSampleId(s.id);
                loadSample(s).catch((e) => setStatus(`Load failed: ${e.message}`));
              }}
              className={`rounded px-3 py-1.5 ${
                sampleId === s.id ? "bg-cyan-600/90 text-white" : "bg-white/10 text-zinc-200 hover:bg-white/20"
              }`}
            >
              {s.name}
            </button>
          ))}
          <button
            onClick={runQC}
            className="rounded bg-emerald-600/90 px-3 py-1.5 font-semibold text-white hover:bg-emerald-500"
          >
            Run QC
          </button>
        </div>
      </div>

      {/* QC report panel */}
      {qcOpen && report && (
        <div className="absolute right-3 top-3 flex max-h-[calc(100vh-120px)] w-80 flex-col rounded-xl border border-white/10 bg-black/75 text-sm text-zinc-200 backdrop-blur">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <span className="font-semibold">QC Report</span>
            <button onClick={() => setQcOpen(false)} className="text-zinc-400 hover:text-white">
              ✕
            </button>
          </div>
          <div className="flex items-center gap-4 px-4 py-3">
            <div
              className={`text-4xl font-bold tabular-nums ${
                report.score >= 90 ? "text-emerald-400" : report.score >= 70 ? "text-amber-400" : "text-red-400"
              }`}
            >
              {report.score}
            </div>
            <div className="text-xs text-zinc-400">
              <div>{report.frames} frames · {report.duration.toFixed(1)}s</div>
              <div>{report.issues.length === 0 ? "no issues found" : `${report.issues.length} issues`}</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 px-4 pb-3 text-xs">
            <div className="rounded bg-white/5 px-2 py-1.5">
              <div className="text-zinc-500">Foot skate</div>
              <div className="tabular-nums">{(report.metrics.footSkateDistance * 100).toFixed(1)} cm</div>
            </div>
            <div className="rounded bg-white/5 px-2 py-1.5">
              <div className="text-zinc-500">Max penetration</div>
              <div className="tabular-nums">{(report.metrics.maxPenetration * 100).toFixed(1)} cm</div>
            </div>
            <div className="rounded bg-white/5 px-2 py-1.5">
              <div className="text-zinc-500">Limit frames</div>
              <div className="tabular-nums">{report.metrics.limitViolationFrames}</div>
            </div>
            <div className="rounded bg-white/5 px-2 py-1.5">
              <div className="text-zinc-500">Teleports</div>
              <div className="tabular-nums">{report.metrics.teleportCount}</div>
            </div>
            <div className="col-span-2 rounded bg-white/5 px-2 py-1.5">
              <div className="text-zinc-500">Peak jerk</div>
              <div className="tabular-nums">
                {report.metrics.peakJerk.toFixed(0)} rad/s³
                {report.metrics.peakJerkJoint ? ` · ${report.metrics.peakJerkJoint}` : ""}
              </div>
            </div>
          </div>
          {report.issues.length > 0 && (
            <div className="min-h-0 flex-1 overflow-y-auto border-t border-white/10">
              {report.issues.map((issue, i) => (
                <button
                  key={i}
                  onClick={() => {
                    seekRef.current = issue.time;
                    setPlaying(false);
                  }}
                  className="block w-full px-4 py-2 text-left text-xs hover:bg-white/10"
                >
                  <span
                    className={`mr-2 inline-block h-2 w-2 rounded-full ${
                      issue.severity > 0.6 ? "bg-red-400" : issue.severity > 0.3 ? "bg-amber-400" : "bg-yellow-200"
                    }`}
                  />
                  <span className="tabular-nums text-zinc-500">{issue.time.toFixed(1)}s</span>{" "}
                  <span className="text-zinc-300">{issue.detail}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* transport bar */}
      <div className="absolute bottom-4 left-1/2 flex w-[min(720px,92vw)] -translate-x-1/2 items-center gap-3 rounded-xl border border-white/10 bg-black/70 px-4 py-3 text-sm text-zinc-200 backdrop-blur">
        <button
          onClick={() => setPlaying((p) => !p)}
          className="flex h-9 w-9 items-center justify-center rounded-full bg-cyan-600 text-white hover:bg-cyan-500"
          aria-label={playing ? "Pause" : "Play"}
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
