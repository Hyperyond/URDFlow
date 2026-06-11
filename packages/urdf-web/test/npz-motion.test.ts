import { describe, expect, it } from "vitest";
import { deflateRawSync } from "node:zlib";
import { parseNpy, parseNpz } from "../src/npz";
import { motionFromNpz, fitJointCount, frameAt, sampleAt } from "../src/motion";

// ---- synthetic .npy / .npz builders (numpy + zip formats, hand-rolled) ----

function buildNpy(shape: number[], data: Float64Array | Int32Array, dtype: string): Uint8Array {
  const shapeStr = shape.length === 1 ? `(${shape[0]},)` : `(${shape.join(", ")})`;
  let header = `{'descr': '${dtype}', 'fortran_order': False, 'shape': ${shapeStr}, }`;
  const baseLen = 10 + header.length + 1; // magic+ver+u16 len + header + \n
  const pad = (64 - (baseLen % 64)) % 64;
  header = header + " ".repeat(pad) + "\n";
  const head = new Uint8Array(10 + header.length);
  head.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]); // \x93NUMPY v1.0
  new DataView(head.buffer).setUint16(8, header.length, true);
  for (let i = 0; i < header.length; i++) head[10 + i] = header.charCodeAt(i);
  const body = new Uint8Array(data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength));
  const out = new Uint8Array(head.length + body.length);
  out.set(head);
  out.set(body, head.length);
  return out;
}

function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]!;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/** Minimal zip writer: entries stored (method 0) or deflated (method 8). */
function buildZip(entries: { name: string; data: Uint8Array; deflate?: boolean }[]): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const e of entries) {
    const method = e.deflate ? 8 : 0;
    const payload = e.deflate ? new Uint8Array(deflateRawSync(e.data)) : e.data;
    const crc = crc32(e.data);
    const name = new TextEncoder().encode(e.name);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, payload.length, true);
    lv.setUint32(22, e.data.length, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    const cent = new Uint8Array(46 + name.length);
    const cv = new DataView(cent.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, payload.length, true);
    cv.setUint32(24, e.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cent.set(name, 46);
    central.push(cent);

    chunks.push(local, payload);
    offset += local.length + payload.length;
  }
  const cdStart = offset;
  let cdLen = 0;
  for (const c of central) {
    chunks.push(c);
    cdLen += c.length;
  }
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdLen, true);
  ev.setUint32(16, cdStart, true);
  chunks.push(eocd);

  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out.buffer;
}

/** OmniRetarget-shaped clip: fps scalar + qpos[T, 7+nq(+7)] */
function buildClipNpz(frames: number, joints: number, withObject: boolean, deflate = false): ArrayBuffer {
  const dim = 7 + joints + (withObject ? 7 : 0);
  const qpos = new Float64Array(frames * dim);
  for (let t = 0; t < frames; t++) {
    const r = t * dim;
    qpos[r] = 1; // qw — identity base orientation
    qpos[r + 4] = t * 0.1; // x walks forward
    qpos[r + 6] = 0.79; // z height
    for (let j = 0; j < joints; j++) qpos[r + 7 + j] = j + t * 0.01;
    if (withObject) {
      qpos[r + 7 + joints] = 1; // object qw
      qpos[r + 7 + joints + 4] = 1.5; // object x
    }
  }
  return buildZip([
    { name: "fps.npy", data: buildNpy([], new Float64Array([50]), "<f8"), deflate },
    { name: "qpos.npy", data: buildNpy([frames, dim], qpos, "<f8"), deflate },
  ]);
}

describe("npz parser", () => {
  it("parses npy scalars and 2-D arrays (stored)", async () => {
    const npz = await parseNpz(buildClipNpz(5, 29, false));
    expect(npz["fps"]!.shape).toEqual([]);
    expect(npz["fps"]!.data[0]).toBe(50);
    expect(npz["qpos"]!.shape).toEqual([5, 36]);
    expect(npz["qpos"]!.data[4]).toBe(0); // frame 0 x
    expect(npz["qpos"]!.data[36 + 4]).toBeCloseTo(0.1); // frame 1 x
  });

  it("parses deflated entries", async () => {
    const npz = await parseNpz(buildClipNpz(3, 4, true, true));
    expect(npz["qpos"]!.shape).toEqual([3, 18]);
    expect(npz["qpos"]!.data[6]).toBeCloseTo(0.79);
  });

  it("parses int32 and rejects unknown dtypes", () => {
    const ok = parseNpy(buildNpy([3], new Int32Array([7, 8, 9]), "<i4"));
    expect(Array.from(ok.data)).toEqual([7, 8, 9]);
    expect(() => parseNpy(buildNpy([1], new Float64Array([1]), "<c16"))).toThrow(/unsupported dtype/);
  });

  it("rejects non-zip buffers", async () => {
    await expect(parseNpz(new ArrayBuffer(64))).rejects.toThrow(/not a zip/);
  });
});

describe("motion clip", () => {
  it("builds a clip and resolves robot-only layout", async () => {
    const clip = fitJointCount(motionFromNpz(await parseNpz(buildClipNpz(10, 29, false))), 29);
    expect(clip.frames).toBe(10);
    expect(clip.fps).toBe(50);
    expect(clip.hasObject).toBe(false);
    expect(clip.duration).toBeCloseTo(0.2);
    const f = frameAt(clip, 3);
    expect(f.base.pos[0]).toBeCloseTo(0.3);
    expect(f.base.pos[2]).toBeCloseTo(0.79);
    expect(f.base.quat[0]).toBe(1);
    expect(f.joints[5]).toBeCloseTo(5 + 0.03);
    expect(f.object).toBeUndefined();
  });

  it("resolves robot+object layout and exposes the object pose", async () => {
    const clip = fitJointCount(motionFromNpz(await parseNpz(buildClipNpz(4, 29, true))), 29);
    expect(clip.hasObject).toBe(true);
    const f = frameAt(clip, 0);
    expect(f.object!.pos[0]).toBeCloseTo(1.5);
    expect(f.object!.quat[0]).toBe(1);
  });

  it("rejects mismatched joint counts", async () => {
    const clip = motionFromNpz(await parseNpz(buildClipNpz(4, 29, false)));
    expect(() => fitJointCount(clip, 12)).toThrow(/does not match/);
  });

  it("interpolates between frames", async () => {
    const clip = fitJointCount(motionFromNpz(await parseNpz(buildClipNpz(10, 29, false))), 29);
    const s = sampleAt(clip, (3.5 / 50) * 1); // halfway between frames 3 and 4
    expect(s.base.pos[0]).toBeCloseTo(0.35);
    expect(s.joints[0]).toBeCloseTo(0.035);
    // clamps past the end
    const end = sampleAt(clip, 999);
    expect(end.base.pos[0]).toBeCloseTo(0.9);
  });
});
