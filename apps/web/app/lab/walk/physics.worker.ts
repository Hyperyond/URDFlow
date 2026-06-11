/// <reference lib="webworker" />

/**
 * MuJoCo runs entirely in this worker: the official WASM bindings are a pthread
 * build whose filesystem/compile calls block waiting for the thread pool — legal in
 * a worker, a deadlock on the browser main thread. The sim self-drives at the model
 * timestep and publishes state through a SharedArrayBuffer:
 *   [0] simTime · [1..3] base pos (MuJoCo Z-up) · [4..7] base quat wxyz · [8..] joints
 */

interface BootMsg {
  type: "boot";
  sceneXml: string;
  g1Xml: string;
  assets: { name: string; buf: ArrayBuffer }[];
  sab: SharedArrayBuffer;
  timestep: number;
}
type InMsg = BootMsg | { type: "reset" } | { type: "push"; vx: number; vy: number };

/** The bindings expose vectors either as embind handles or TypedArray views — duck-type. */
type MjVec = Float64Array | { size(): number; get(i: number): number | undefined; set(i: number, v: number): boolean };
const vLen = (v: MjVec): number => (ArrayBuffer.isView(v) ? v.length : v.size());
const vGet = (v: MjVec, i: number): number => (ArrayBuffer.isView(v) ? (v[i] ?? 0) : (v.get(i) ?? 0));
const vSet = (v: MjVec, i: number, x: number): void => {
  if (ArrayBuffer.isView(v)) v[i] = x;
  else v.set(i, x);
};

let mj: {
  mj_step: (m: unknown, d: unknown) => void;
  mj_forward: (m: unknown, d: unknown) => void;
  mj_resetDataKeyframe: (m: unknown, d: unknown, k: number) => void;
} | null = null;
let model: unknown = null;
let data: { qpos: MjVec; qvel: MjVec; ctrl: MjVec; time?: number } | null = null;
let homeCtrl: number[] = [];
let out: Float64Array | null = null;
let njoint = 0;

function publish(): void {
  if (!out || !data) return;
  out[0] = data.time ?? 0;
  for (let i = 0; i < 7 + njoint; i++) out[1 + i] = vGet(data.qpos, i);
}

async function boot(msg: BootMsg): Promise<void> {
  postMessage({ type: "progress", step: "importing bindings" });
  // load the emscripten module UNbundled: webpack rewrites (chunking, topLevelAwait)
  // break its self-referencing pthread workers — straight from /public it manages
  // its own worker pool correctly
  const factory = (
    (await import(/* webpackIgnore: true */ "/mujoco.mjs" as string)) as {
      default: (opts?: unknown) => Promise<unknown>;
    }
  ).default;
  postMessage({ type: "progress", step: "instantiating wasm" });
  const m = (await factory({
    locateFile: (f: string) => (f.endsWith(".wasm") ? "/mujoco.wasm" : f),
  })) as typeof mj & {
    FS: { mkdir: (p: string) => void; writeFile: (p: string, d: Uint8Array | string) => void };
    MjModel: { mj_loadXML: (p: string) => unknown };
    MjData: new (m: unknown) => NonNullable<typeof data>;
  };
  postMessage({ type: "progress", step: "writing FS" });
  m!.FS.mkdir("/g1");
  m!.FS.mkdir("/g1/assets");
  m!.FS.writeFile("/g1/scene_mjx.xml", msg.sceneXml);
  m!.FS.writeFile("/g1/g1_mjx.xml", msg.g1Xml);
  for (const a of msg.assets) m!.FS.writeFile(`/g1/assets/${a.name}`, new Uint8Array(a.buf));

  // probe: a trivial model first — separates binding-level hangs from G1 specifics
  m!.FS.writeFile(
    "/probe.xml",
    `<mujoco><worldbody><body pos="0 0 1"><freejoint/><geom type="box" size=".1 .1 .1"/></body></worldbody></mujoco>`,
  );
  postMessage({ type: "progress", step: "probe mj_loadXML (tiny box)" });
  const probe = m!.MjModel.mj_loadXML("/probe.xml");
  const meshTags = (msg.g1Xml.match(/<mesh/g) ?? []).length;
  const meshRefs = (msg.g1Xml.match(/\bmesh="/g) ?? []).length;
  postMessage({ type: "progress", step: `probe ok; g1 leftovers mesh<${meshTags}> ref=${meshRefs}; loading g1_mjx alone` });
  const g1Only = m!.MjModel.mj_loadXML("/g1/g1_mjx.xml");
  postMessage({ type: "progress", step: `g1_mjx alone ok (${g1Only ? "model" : "null"}) — loading scene` });
  model = m!.MjModel.mj_loadXML("/g1/scene_mjx.xml");
  postMessage({ type: "progress", step: "model loaded" });
  data = new m!.MjData(model);
  mj = m;
  mj.mj_resetDataKeyframe(model, data, 0); // 'home' keyframe seeds qpos + ctrl
  mj.mj_forward(model, data);
  homeCtrl = Array.from({ length: vLen(data.ctrl) }, (_, i) => vGet(data!.ctrl, i));

  out = new Float64Array(msg.sab);
  njoint = vLen(data.qpos) - 7;
  publish();
  postMessage({ type: "ready", njoint });

  // self-driven loop at the model timestep, batched per interval tick
  const dt = msg.timestep;
  let last = performance.now();
  setInterval(() => {
    if (!mj || !data) return;
    const now = performance.now();
    let steps = Math.min(Math.round((now - last) / 1000 / dt), 25);
    last = now;
    while (steps-- > 0) {
      for (let i = 0; i < homeCtrl.length; i++) vSet(data.ctrl, i, homeCtrl[i]!);
      mj.mj_step(model, data);
    }
    publish();
  }, 8);
}

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === "boot") {
    boot(msg).catch((err) =>
      postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  } else if (msg.type === "reset" && mj && data) {
    mj.mj_resetDataKeyframe(model, data, 0);
    mj.mj_forward(model, data);
    publish();
  } else if (msg.type === "push" && data) {
    vSet(data.qvel, 0, vGet(data.qvel, 0) + msg.vx);
    vSet(data.qvel, 1, vGet(data.qvel, 1) + msg.vy);
  }
};
