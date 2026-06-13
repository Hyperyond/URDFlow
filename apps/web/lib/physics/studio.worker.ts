/// <reference lib="webworker" />

export {}; // module scope — keeps identifiers from clashing with the walk-lab worker

/**
 * Generic studio physics worker: boots MuJoCo WASM on a compiled scene MJCF
 * (robot + free boxes + ground), self-steps at the model timestep, and
 * publishes state through a SharedArrayBuffer. Position-actuator targets
 * stream in via "ctrl" messages; the sim holds the last targets between
 * messages (exactly how a real arm's joint controller behaves).
 *
 * SAB layout (Float64):
 *   [0]                       sim time, seconds
 *   [1 .. njoint]             joint qpos, MJCF tree order
 *   [1+njoint .. +7 each]     free bodies: x y z (Z-up) + quat w x y z
 *   [last]                    contact count (ncon), -1 if bindings hide it
 *
 * The MuJoCo bindings are a pthread build — FS/compile calls block on the
 * worker pool, which is legal here and a deadlock on the main thread.
 */

interface BootMsg {
  type: "boot";
  xml: string;
  assets: { file: string; buf: ArrayBuffer }[];
  sab: SharedArrayBuffer;
  njoint: number;
  nfree: number;
  /** Initial joint positions (njoint, tree order) — robot's current editor pose. */
  initialQpos: number[];
  /** Initial actuator targets (ctrl order). */
  initialCtrl: number[];
}
type InMsg = BootMsg | { type: "ctrl"; targets: number[] } | { type: "reset" };

type MjVec = Float64Array | { size(): number; get(i: number): number | undefined; set(i: number, v: number): boolean };
const vLen = (v: MjVec): number => (ArrayBuffer.isView(v) ? v.length : v.size());
const vGet = (v: MjVec, i: number): number => (ArrayBuffer.isView(v) ? (v[i] ?? 0) : (v.get(i) ?? 0));
const vSet = (v: MjVec, i: number, x: number): void => {
  if (ArrayBuffer.isView(v)) v[i] = x;
  else v.set(i, x);
};

let mj: { mj_step: (m: unknown, d: unknown) => void; mj_forward: (m: unknown, d: unknown) => void } | null = null;
let model: unknown = null;
let data: { qpos: MjVec; qvel: MjVec; ctrl: MjVec; time?: number; ncon?: number } | null = null;
let out: Float64Array | null = null;
let njoint = 0;
let nfree = 0;
let boot0: { qpos: number[]; ctrl: number[] } | null = null;

function publish(): void {
  if (!out || !data) return;
  out[0] = data.time ?? 0;
  const n = njoint + 7 * nfree;
  for (let i = 0; i < n; i++) out[1 + i] = vGet(data.qpos, i);
  out[1 + n] = typeof data.ncon === "number" ? data.ncon : -1;
}

function applyInitial(): void {
  if (!mj || !data || !boot0) return;
  for (let i = 0; i < vLen(data.qvel); i++) vSet(data.qvel, i, 0);
  for (let i = 0; i < boot0.qpos.length; i++) vSet(data.qpos, i, boot0.qpos[i]!);
  for (let i = 0; i < boot0.ctrl.length && i < vLen(data.ctrl); i++) vSet(data.ctrl, i, boot0.ctrl[i]!);
  mj.mj_forward(model, data);
}

async function boot(msg: BootMsg): Promise<void> {
  postMessage({ type: "progress", step: "instantiating wasm" });
  const factory = (
    (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "/mujoco.mjs" as string)) as {
      default: (opts?: unknown) => Promise<unknown>;
    }
  ).default;
  const m = (await factory({
    locateFile: (f: string) => (f.endsWith(".wasm") ? "/mujoco.wasm" : f),
  })) as typeof mj & {
    FS: { mkdir: (p: string) => void; writeFile: (p: string, d: Uint8Array | string) => void };
    MjModel: { mj_loadXML: (p: string) => unknown };
    MjData: new (m: unknown) => NonNullable<typeof data>;
  };
  // the pthread pool fills via queued worker spawns — yield a macrotask so they
  // complete before the first FS call proxies to the runtime thread
  await new Promise((r) => setTimeout(r, 50));

  postMessage({ type: "progress", step: "writing FS" });
  m!.FS.mkdir("/scene");
  m!.FS.mkdir("/scene/assets");
  m!.FS.writeFile("/scene/scene.xml", msg.xml);
  for (const a of msg.assets) m!.FS.writeFile(`/scene/assets/${a.file}`, new Uint8Array(a.buf));

  postMessage({ type: "progress", step: "mj_loadXML" });
  model = m!.MjModel.mj_loadXML("/scene/scene.xml");
  if (!model) throw new Error("mj_loadXML returned null — scene MJCF failed to compile");
  postMessage({ type: "progress", step: "model loaded" });
  data = new m!.MjData(model);
  mj = m;

  njoint = msg.njoint;
  nfree = msg.nfree;
  const nq = vLen(data.qpos);
  if (nq !== njoint + 7 * nfree) {
    throw new Error(`qpos layout mismatch: model nq=${nq}, expected ${njoint}+7×${nfree}`);
  }
  // free-body initial poses come from the MJCF <body pos>; only seed robot joints
  boot0 = {
    qpos: msg.initialQpos.concat(
      Array.from({ length: 7 * nfree }, (_, i) => vGet(data!.qpos, njoint + i)),
    ),
    ctrl: msg.initialCtrl,
  };
  applyInitial();

  out = new Float64Array(msg.sab);
  publish();
  postMessage({ type: "ready", njoint, nfree });

  // self-driven stepping batched per tick; clamp catch-up to keep the tab responsive
  const dt = 0.002;
  let last = performance.now();
  setInterval(() => {
    if (!mj || !data) return;
    const now = performance.now();
    let steps = Math.min(Math.round((now - last) / 1000 / dt), 25);
    last = now;
    while (steps-- > 0) mj.mj_step(model, data);
    publish();
  }, 8);
}

self.onmessage = (e: MessageEvent<InMsg>) => {
  const msg = e.data;
  if (msg.type === "boot") {
    boot(msg).catch((err) =>
      postMessage({ type: "error", message: err instanceof Error ? err.message : String(err) }),
    );
  } else if (msg.type === "ctrl" && data) {
    for (let i = 0; i < msg.targets.length && i < vLen(data.ctrl); i++) {
      vSet(data.ctrl, i, msg.targets[i]!);
    }
  } else if (msg.type === "reset") {
    applyInitial();
    publish();
  }
};
