/// <reference lib="webworker" />

/**
 * MuJoCo runs entirely in this worker: the official WASM bindings are a pthread
 * build whose filesystem/compile calls block waiting for the thread pool — legal in
 * a worker, a deadlock on the browser main thread. The sim self-drives at the model
 * timestep and publishes state through a SharedArrayBuffer:
 *   [0] simTime · [1..3] base pos (MuJoCo Z-up) · [4..7] base quat wxyz · [8..] joints
 *
 * Locomotion (P1): unitree_rl_gym's pre-trained G1 policy (motion.pt, BSD-3-Clause)
 * re-implemented as a hand-written LSTM(47→64) + Linear(64→32) + ELU + Linear(32→12)
 * forward pass — weights extracted from the TorchScript archive into
 * /robots/g1/policy/g1_walk_lstm.json. It expects the deploy-config PD law
 * (kp [100,100,100,150,40,40], kd [2,2,2,4,2,2] per leg), which MuJoCo position
 * actuators implement exactly (tau = kp·(ctrl−q) − kv·dq), so we patch those gains
 * onto the 12 leg actuators and feed action·0.25 + default_angles as ctrl at 50 Hz.
 */

interface BootMsg {
  type: "boot";
  sceneXml: string;
  g1Xml: string;
  assets: { name: string; buf: ArrayBuffer }[];
  sab: SharedArrayBuffer;
  timestep: number;
  policyUrl?: string;
}
type InMsg =
  | BootMsg
  | { type: "reset" }
  | { type: "push"; vx: number; vy: number }
  | { type: "cmd"; vx: number; vy: number; wz: number };

/** The bindings expose vectors either as embind handles or TypedArray views — duck-type. */
type MjVec = Float64Array | { size(): number; get(i: number): number | undefined; set(i: number, v: number): boolean };
const vLen = (v: MjVec): number => (ArrayBuffer.isView(v) ? v.length : v.size());
const vGet = (v: MjVec, i: number): number => (ArrayBuffer.isView(v) ? (v[i] ?? 0) : (v.get(i) ?? 0));
const vSet = (v: MjVec, i: number, x: number): void => {
  if (ArrayBuffer.isView(v)) v[i] = x;
  else v.set(i, x);
};

// ---- unitree_rl_gym deploy config (deploy/deploy_mujoco/configs/g1.yaml) ----
const LEG_JOINTS = [
  "left_hip_pitch_joint",
  "left_hip_roll_joint",
  "left_hip_yaw_joint",
  "left_knee_joint",
  "left_ankle_pitch_joint",
  "left_ankle_roll_joint",
  "right_hip_pitch_joint",
  "right_hip_roll_joint",
  "right_hip_yaw_joint",
  "right_knee_joint",
  "right_ankle_pitch_joint",
  "right_ankle_roll_joint",
];
const KP = [100, 100, 100, 150, 40, 40, 100, 100, 100, 150, 40, 40];
const KD = [2, 2, 2, 4, 2, 2, 2, 2, 2, 4, 2, 2];
const DEFAULT_ANGLES = [-0.1, 0, 0, 0.3, -0.2, 0, -0.1, 0, 0, 0.3, -0.2, 0];
const ANG_VEL_SCALE = 0.25;
const DOF_VEL_SCALE = 0.05;
const ACTION_SCALE = 0.25;
const CMD_SCALE = [2.0, 2.0, 0.25];
const GAIT_PERIOD = 0.8; // s — phase clock the gait was trained on
const POLICY_DT = 0.02; // 50 Hz, matches deploy (0.002·10); ours is 0.004·5

function b64f32(s: string): Float32Array {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return new Float32Array(u8.buffer);
}

/** y = W·x + b (+y0), W row-major [out,in] */
function matvec(W: Float32Array, x: Float32Array, b: Float32Array, y: Float32Array, accumulate = false): void {
  const out = y.length;
  const inn = x.length;
  for (let r = 0; r < out; r++) {
    let s = b[r]!;
    const row = r * inn;
    for (let c = 0; c < inn; c++) s += W[row + c]! * x[c]!;
    y[r] = accumulate ? y[r]! + s : s;
  }
}
const sigmoid = (x: number): number => 1 / (1 + Math.exp(-x));
const elu = (x: number): number => (x > 0 ? x : Math.exp(x) - 1);

/** Hand-written forward pass of unitree's PolicyExporterLSTM (gates in torch i,f,g,o order). */
class WalkPolicy {
  private wIh: Float32Array;
  private wHh: Float32Array;
  private bIh: Float32Array;
  private bHh: Float32Array;
  private w0: Float32Array;
  private b0: Float32Array;
  private w2: Float32Array;
  private b2: Float32Array;
  private readonly H = 64;
  private h = new Float32Array(64);
  private c = new Float32Array(64);
  private gates = new Float32Array(256);
  private hid = new Float32Array(32);
  readonly action = new Float32Array(12);

  constructor(tensors: Record<string, { shape: number[]; data: string }>) {
    const t = (n: string): Float32Array => {
      const e = tensors[n];
      if (!e) throw new Error(`policy tensor missing: ${n}`);
      return b64f32(e.data);
    };
    this.wIh = t("lstm.weight_ih");
    this.wHh = t("lstm.weight_hh");
    this.bIh = t("lstm.bias_ih");
    this.bHh = t("lstm.bias_hh");
    this.w0 = t("actor.0.weight");
    this.b0 = t("actor.0.bias");
    this.w2 = t("actor.2.weight");
    this.b2 = t("actor.2.bias");
  }

  reset(): void {
    this.h.fill(0);
    this.c.fill(0);
    this.action.fill(0);
  }

  forward(obs: Float32Array): Float32Array {
    const { H, gates } = this;
    matvec(this.wIh, obs, this.bIh, gates);
    matvec(this.wHh, this.h, this.bHh, gates, true);
    for (let j = 0; j < H; j++) {
      const i = sigmoid(gates[j]!);
      const f = sigmoid(gates[H + j]!);
      const g = Math.tanh(gates[2 * H + j]!);
      const o = sigmoid(gates[3 * H + j]!);
      const c = f * this.c[j]! + i * g;
      this.c[j] = c;
      this.h[j] = o * Math.tanh(c);
    }
    matvec(this.w0, this.h, this.b0, this.hid);
    for (let j = 0; j < this.hid.length; j++) this.hid[j] = elu(this.hid[j]!);
    matvec(this.w2, this.hid, this.b2, this.action);
    return this.action;
  }
}

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

let policy: WalkPolicy | null = null;
let legQpos: number[] = [];
let legQvel: number[] = [];
let legCtrl: number[] = [];
const legTarget = DEFAULT_ANGLES.slice();
const cmd = [0, 0, 0]; // vx, vy, wz — starts standing (stepping in place)
let simSteps = 0;
let stepsPerPolicyTick = 5;
const obs = new Float32Array(47);

function buildObs(): Float32Array {
  if (!data) return obs;
  // [0:3] base angular velocity, body frame (free-joint qvel[3:6] is local) · scaled
  for (let i = 0; i < 3; i++) obs[i] = vGet(data.qvel, 3 + i) * ANG_VEL_SCALE;
  // [3:6] gravity direction in body frame, from base quat (w,x,y,z)
  const qw = vGet(data.qpos, 3);
  const qx = vGet(data.qpos, 4);
  const qy = vGet(data.qpos, 5);
  const qz = vGet(data.qpos, 6);
  obs[3] = 2 * (-qz * qx + qw * qy);
  obs[4] = -2 * (qz * qy + qw * qx);
  obs[5] = 1 - 2 * (qw * qw + qz * qz);
  // [6:9] velocity command
  obs[6] = cmd[0]! * CMD_SCALE[0]!;
  obs[7] = cmd[1]! * CMD_SCALE[1]!;
  obs[8] = cmd[2]! * CMD_SCALE[2]!;
  // [9:21] leg joint positions − defaults · [21:33] velocities · [33:45] last action
  for (let i = 0; i < 12; i++) {
    obs[9 + i] = vGet(data.qpos, legQpos[i]!) - DEFAULT_ANGLES[i]!;
    obs[21 + i] = vGet(data.qvel, legQvel[i]!) * DOF_VEL_SCALE;
    obs[33 + i] = policy!.action[i]!;
  }
  // [45:47] gait phase clock
  const phase = ((data.time ?? 0) % GAIT_PERIOD) / GAIT_PERIOD;
  obs[45] = Math.sin(2 * Math.PI * phase);
  obs[46] = Math.cos(2 * Math.PI * phase);
  return obs;
}

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
    (await import(/* webpackIgnore: true */ /* turbopackIgnore: true */ "/mujoco.mjs" as string)) as {
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

  // the policy was trained against explicit PD gains — patch them onto the leg
  // position actuators (MuJoCo position actuator == the same PD law)
  let g1Xml = msg.g1Xml;
  LEG_JOINTS.forEach((j, i) => {
    const before = g1Xml;
    g1Xml = g1Xml.replace(new RegExp(`(<position[^>]*name="${j}")`), `$1 kp="${KP[i]}" kv="${KD[i]}"`);
    if (g1Xml === before) throw new Error(`leg actuator not found in MJCF: ${j}`);
  });
  // …and it was trained with the upper body WELDED (unitree's 12-dof deploy model).
  // The menagerie defaults (waist kp 75, arms kp 20) leave the arms swinging freely —
  // a large unmodeled disturbance. Stiffen the non-leg actuators to approximate the
  // rigid upper body (actuatorfrcrange still caps the torques).
  g1Xml = g1Xml
    .replace(/<position inheritrange="1" kp="75" kv="2"\/>/, `<position inheritrange="1" kp="400" kv="10"/>`)
    .replace(/<position kp="20" kv="2"\/>/g, `<position kp="200" kv="5"/>`);

  postMessage({ type: "progress", step: "writing FS" });
  m!.FS.mkdir("/g1");
  m!.FS.mkdir("/g1/assets");
  m!.FS.writeFile("/g1/scene_mjx.xml", msg.sceneXml);
  m!.FS.writeFile("/g1/g1_mjx.xml", g1Xml);
  for (const a of msg.assets) m!.FS.writeFile(`/g1/assets/${a.name}`, new Uint8Array(a.buf));

  postMessage({ type: "progress", step: "mj_loadXML" });
  model = m!.MjModel.mj_loadXML("/g1/scene_mjx.xml");
  if (!model) throw new Error("mj_loadXML returned null");
  data = new m!.MjData(model);
  mj = m;
  mj.mj_resetDataKeyframe(model, data, 0); // 'home' keyframe seeds qpos + ctrl
  mj.mj_forward(model, data);
  homeCtrl = Array.from({ length: vLen(data.ctrl) }, (_, i) => vGet(data!.ctrl, i));

  // joint order in the MJCF body tree = qpos layout after the 7-dof free joint;
  // actuator order = ctrl layout
  const jointNames = [...g1Xml.matchAll(/<joint name="([^"]+)"/g)].map((mm) => mm[1]!);
  const actNames = [...g1Xml.matchAll(/<position[^>]*\bname="([^"]+)"/g)].map((mm) => mm[1]!);
  legQpos = LEG_JOINTS.map((j) => 7 + jointNames.indexOf(j));
  legQvel = LEG_JOINTS.map((j) => 6 + jointNames.indexOf(j));
  legCtrl = LEG_JOINTS.map((j) => actNames.indexOf(j));
  if (legQpos.some((i) => i < 7) || legCtrl.some((i) => i < 0)) {
    throw new Error("leg joint/actuator mapping failed");
  }

  if (msg.policyUrl) {
    postMessage({ type: "progress", step: "loading walk policy" });
    const pj = (await (await fetch(msg.policyUrl)).json()) as {
      tensors: Record<string, { shape: number[]; data: string }>;
    };
    policy = new WalkPolicy(pj.tensors);
  }

  out = new Float64Array(msg.sab);
  njoint = vLen(data.qpos) - 7;
  stepsPerPolicyTick = Math.max(1, Math.round(POLICY_DT / msg.timestep));
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
      if (policy && simSteps % stepsPerPolicyTick === 0) {
        const a = policy.forward(buildObs());
        for (let i = 0; i < 12; i++) legTarget[i] = DEFAULT_ANGLES[i]! + a[i]! * ACTION_SCALE;
      }
      for (let i = 0; i < homeCtrl.length; i++) vSet(data.ctrl, i, homeCtrl[i]!);
      if (policy) for (let i = 0; i < 12; i++) vSet(data.ctrl, legCtrl[i]!, legTarget[i]!);
      mj.mj_step(model, data);
      simSteps++;
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
    policy?.reset();
    for (let i = 0; i < 12; i++) legTarget[i] = DEFAULT_ANGLES[i]!;
    simSteps = 0;
    publish();
  } else if (msg.type === "push" && data) {
    vSet(data.qvel, 0, vGet(data.qvel, 0) + msg.vx);
    vSet(data.qvel, 1, vGet(data.qvel, 1) + msg.vy);
  } else if (msg.type === "cmd") {
    cmd[0] = msg.vx;
    cmd[1] = msg.vy;
    cmd[2] = msg.wz;
  }
};
