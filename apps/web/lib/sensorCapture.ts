/**
 * Sensor-data capture for sim2real datasets: alongside the RGB the CaptureRig
 * already renders, this adds per-pixel depth (uint16 millimeters, RealSense
 * convention, 0 = no return) and segmentation masks (uint8 ids, one per URDF
 * link / tagged scene object), plus the episode buffering and dataset export.
 *
 * Layout of the exported zip (one episode):
 *   meta.json                 cameras (K + extrinsics), seg labels, joints, fps
 *   rgb/<cam>/000000.png …    sRGB frames as rendered
 *   depth_<cam>.npy           <u2 [T,H,W] millimeters, deflated
 *   seg_<cam>.npy             |u1 [T,H,W] label ids, deflated
 *   qpos.npy                  <f4 [T,nq] joint positions (radians/meters)
 *   timestamps.npy            <f4 [T] seconds from episode start
 */

import {
  Color,
  MeshBasicMaterial,
  Quaternion as ThreeQuaternion,
  ShaderMaterial,
  Vector3,
  type Mesh,
  type Object3D,
  type Scene,
} from "three";
import {
  buildZip,
  deflateEntry,
  encodeNpy,
  intrinsicsFromFov,
  type CameraIntrinsics,
  type URDFRobot,
  type ZipEntry,
} from "@urdflow/urdf-web";

// ---------------------------------------------------------------------------
// GL materials

/** Writes view-space z (meters, perpendicular depth — what real depth cams report) into R. */
export function createDepthMaterial(): ShaderMaterial {
  return new ShaderMaterial({
    vertexShader: /* glsl */ `
      varying float vViewZ;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vViewZ = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      varying float vViewZ;
      void main() { gl_FragColor = vec4(vViewZ, 0.0, 0.0, 1.0); }`,
  });
}

const segMaterials = new Map<number, MeshBasicMaterial>();

/** Flat unlit material encoding a label id in the red byte (tone mapping off → exact bytes). */
export function segMaterial(id: number): MeshBasicMaterial {
  let m = segMaterials.get(id);
  if (!m) {
    m = new MeshBasicMaterial({ color: new Color(id / 255, 0, 0), toneMapped: false, fog: false });
    segMaterials.set(id, m);
  }
  return m;
}

// ---------------------------------------------------------------------------
// Segmentation labeling

/** Walk up from a mesh: URDF link name, explicit userData.segName tag, else "env". */
export function segLabelFor(mesh: Object3D): string {
  for (let o: Object3D | null = mesh; o; o = o.parent) {
    if ((o as { isURDFLink?: boolean }).isURDFLink) return `link:${o.name}`;
    const tag = (o.userData as { segName?: string }).segName;
    if (tag) return tag;
  }
  return "env";
}

export interface SegAssignment {
  mesh: Mesh;
  id: number;
}

/**
 * Map every capture-layer mesh to a stable label id. `labels` is shared with
 * the session (index = id) and grows as new labels appear; id 0 = background.
 */
export function buildSegAssignments(scene: Scene, layer: number, labels: string[]): SegAssignment[] {
  const out: SegAssignment[] = [];
  scene.traverse((o) => {
    const mesh = o as Mesh;
    if (!mesh.isMesh || !(mesh.layers.mask & (1 << layer))) return;
    const label = segLabelFor(mesh);
    let id = labels.indexOf(label);
    if (id < 0) {
      if (labels.length > 255) return; // uint8 mask — beyond 255 labels, skip
      id = labels.length;
      labels.push(label);
    }
    out.push({ mesh, id });
  });
  return out;
}

// ---------------------------------------------------------------------------
// Readback conversions (WebGL reads bottom-up; datasets are top-down)

/** RGBA bottom-up → RGB top-down. */
export function flipToRGB(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h * 3);
  for (let y = 0; y < h; y++) {
    let s = (h - 1 - y) * w * 4;
    let d = y * w * 3;
    for (let x = 0; x < w; x++, s += 4, d += 3) {
      out[d] = src[s]!;
      out[d + 1] = src[s + 1]!;
      out[d + 2] = src[s + 2]!;
    }
  }
  return out;
}

/** Float meters (RGBA.r, bottom-up) → uint16 millimeters top-down, clamped at 65.535 m. */
export function depthToMM(src: Float32Array, w: number, h: number): Uint16Array {
  const out = new Uint16Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = (h - 1 - y) * w * 4;
    let d = y * w;
    for (let x = 0; x < w; x++, s += 4, d++) {
      const mm = src[s]! * 1000;
      out[d] = mm <= 0 ? 0 : mm >= 65535 ? 65535 : Math.round(mm);
    }
  }
  return out;
}

/** RGBA bytes (id in red, bottom-up) → uint8 id raster top-down. */
export function segToIds(src: Uint8Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let s = (h - 1 - y) * w * 4;
    let d = y * w;
    for (let x = 0; x < w; x++, s += 4, d++) out[d] = src[s]!;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Episode session

export interface SensorCameraMeta {
  name: string;
  width: number;
  height: number;
  intrinsics: CameraIntrinsics;
  near: number;
  far: number;
  /** Column-major 4×4 camera-to-world (OpenGL convention: looks down -Z). */
  worldTCam: number[];
}

export interface SensorFrame {
  t: number;
  qpos: Float32Array;
  /** Ground-truth world poses of tagged scene objects: [x,y,z,qx,qy,qz,qw] × nobj. */
  objPoses: Float32Array;
  rgb: Record<string, Uint8Array>;
  depth: Record<string, Uint16Array>;
  seg: Record<string, Uint8Array>;
}

/** One recording episode: fixed-rate frame buffer plus everything meta.json needs. */
export class SensorSession {
  readonly hz: number;
  frames: SensorFrame[] = [];
  cameras: SensorCameraMeta[] = [];
  segLabels: string[] = ["background"];
  jointNames: string[] = [];
  /** Tagged scene objects, locked on first frame (order = objPoses layout). */
  objNames: string[] = [];
  private startT: number | null = null;
  private lastT = -Infinity;

  constructor(hz = 20) {
    this.hz = hz;
  }

  /** Rate gate, called once per rendered frame with the rig clock. */
  due(elapsed: number): boolean {
    if (elapsed - this.lastT < 1 / this.hz - 1e-4) return false;
    this.lastT = elapsed;
    if (this.startT === null) this.startT = elapsed;
    return true;
  }

  episodeTime(elapsed: number): number {
    return elapsed - (this.startT ?? elapsed);
  }

  /** Movable-joint positions; locks the name order on first call. */
  readQpos(robot: URDFRobot): Float32Array {
    const joints = (robot as unknown as { joints: Record<string, { jointType: string; angle: number }> }).joints;
    if (this.jointNames.length === 0) {
      this.jointNames = Object.keys(joints)
        .filter((n) => joints[n]!.jointType !== "fixed")
        .sort();
    }
    return Float32Array.from(this.jointNames, (n) => joints[n]?.angle ?? 0);
  }

  registerCamera(meta: SensorCameraMeta): void {
    if (!this.cameras.some((c) => c.name === meta.name)) this.cameras.push(meta);
  }

  /** World poses of scene objects tagged `object:*`; locks the name order on first call. */
  readObjPoses(scene: Scene): Float32Array {
    const tagged = new Map<string, Object3D>();
    scene.traverse((o) => {
      const tag = (o.userData as { segName?: string }).segName;
      if (tag?.startsWith("object:")) tagged.set(tag, o);
    });
    if (this.objNames.length === 0) this.objNames = [...tagged.keys()].sort();
    const out = new Float32Array(this.objNames.length * 7);
    const p = new Vector3();
    const q = new ThreeQuaternion();
    this.objNames.forEach((name, i) => {
      const o = tagged.get(name);
      if (!o) return;
      o.getWorldPosition(p);
      o.getWorldQuaternion(q);
      out.set([p.x, p.y, p.z, q.x, q.y, q.z, q.w], i * 7);
    });
    return out;
  }
}

/** Camera meta from the rig's fov-driven PerspectiveCamera. */
export function cameraMeta(
  name: string,
  width: number,
  height: number,
  cam: { fov: number; near: number; far: number; matrixWorld: { toArray(): number[] } },
): SensorCameraMeta {
  return {
    name,
    width,
    height,
    intrinsics: intrinsicsFromFov(cam.fov, width, height),
    near: cam.near,
    far: cam.far,
    worldTCam: cam.matrixWorld.toArray(),
  };
}

// ---------------------------------------------------------------------------
// Dataset export

async function pngEncode(rgb: Uint8Array, w: number, h: number): Promise<Uint8Array> {
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < rgb.length; i += 3, j += 4) {
    rgba[j] = rgb[i]!;
    rgba[j + 1] = rgb[i + 1]!;
    rgba[j + 2] = rgb[i + 2]!;
    rgba[j + 3] = 255;
  }
  const canvas = new OffscreenCanvas(w, h);
  canvas.getContext("2d")!.putImageData(new ImageData(rgba, w, h), 0, 0);
  return new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
}

/** Concatenate per-frame rasters into one [T,…] array. */
function stack<T extends Uint8Array | Uint16Array | Float32Array>(
  parts: T[],
  make: (n: number) => T,
): T {
  const per = parts[0]?.length ?? 0;
  const out = make(per * parts.length);
  parts.forEach((p, i) => out.set(p as never, i * per));
  return out;
}

export async function exportDatasetZip(session: SensorSession): Promise<Blob> {
  const { frames, cameras } = session;
  if (frames.length === 0) throw new Error("no frames captured");
  const T = frames.length;
  const entries: ZipEntry[] = [];

  const meta = {
    format: "urdflow-sensor-dataset/v1",
    fps: session.hz,
    frame_count: T,
    depth_scale: 0.001, // uint16 value × scale = meters; 0 = no return
    cameras: cameras.map((c) => ({
      name: c.name,
      width: c.width,
      height: c.height,
      fx: c.intrinsics.fx,
      fy: c.intrinsics.fy,
      cx: c.intrinsics.cx,
      cy: c.intrinsics.cy,
      near: c.near,
      far: c.far,
      world_t_cam: c.worldTCam, // column-major 4×4, camera looks down -Z
    })),
    seg_labels: session.segLabels,
    joint_names: session.jointNames,
    object_names: session.objNames, // obj_poses.npy rows: [x,y,z,qx,qy,qz,qw] per name
  };
  entries.push({ name: "meta.json", data: new TextEncoder().encode(JSON.stringify(meta, null, 2)) });

  for (const cam of cameras) {
    const { width: w, height: h, name } = cam;
    for (let i = 0; i < T; i++) {
      entries.push({
        name: `rgb/${name}/${String(i).padStart(6, "0")}.png`,
        data: await pngEncode(frames[i]!.rgb[name]!, w, h),
      });
    }
    entries.push(
      await deflateEntry(
        `depth_${name}.npy`,
        encodeNpy({
          shape: [T, h, w],
          dtype: "<u2",
          data: stack(frames.map((f) => f.depth[name]!), (n) => new Uint16Array(n)),
        }),
      ),
      await deflateEntry(
        `seg_${name}.npy`,
        encodeNpy({
          shape: [T, h, w],
          dtype: "|u1",
          data: stack(frames.map((f) => f.seg[name]!), (n) => new Uint8Array(n)),
        }),
      ),
    );
  }

  const nq = session.jointNames.length;
  const qpos = new Float32Array(T * nq);
  frames.forEach((f, i) => qpos.set(f.qpos, i * nq));
  entries.push(
    await deflateEntry("qpos.npy", encodeNpy({ shape: [T, nq], dtype: "<f4", data: qpos })),
    await deflateEntry(
      "timestamps.npy",
      encodeNpy({ shape: [T], dtype: "<f4", data: Float32Array.from(frames, (f) => f.t) }),
    ),
  );
  const nobj = session.objNames.length;
  if (nobj > 0) {
    const poses = new Float32Array(T * nobj * 7);
    frames.forEach((f, i) => poses.set(f.objPoses, i * nobj * 7));
    entries.push(
      await deflateEntry("obj_poses.npy", encodeNpy({ shape: [T, nobj, 7], dtype: "<f4", data: poses })),
    );
  }

  return new Blob([buildZip(entries)], { type: "application/zip" });
}
