/**
 * Minimal .npy / .npz writer — zero dependencies, browser and Node 18+.
 * Counterpart to the reader in npz.ts. Covers the dtypes sensor dumps
 * actually use: f4/f8 (states), u2 (depth in millimeters), u1 (seg masks), i4.
 */

import { buildZip, deflateEntry, type ZipEntry } from "./zip";

export type NpyDType = "<f4" | "<f8" | "<i4" | "<u2" | "|u1";

export interface NpySource {
  shape: number[];
  dtype: NpyDType;
  /** Flat C-order data; length must equal the product of `shape`. */
  data: Float32Array | Float64Array | Int32Array | Uint16Array | Uint8Array;
}

const te = new TextEncoder();

const isLittleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;

/** Encode one array as .npy v1 (header padded to 64-byte alignment per spec). */
export function encodeNpy(src: NpySource): Uint8Array {
  const count = src.shape.reduce((a, b) => a * b, 1);
  if (src.data.length !== count) {
    throw new Error(`shape (${src.shape.join(",")}) wants ${count} elements, data has ${src.data.length}`);
  }
  // numpy renders 1-tuples as "(n,)"
  const shapeStr = src.shape.length === 1 ? `(${src.shape[0]},)` : `(${src.shape.join(", ")})`;
  let header = `{'descr': '${src.dtype}', 'fortran_order': False, 'shape': ${shapeStr}, }`;
  const unpadded = 10 + header.length + 1; // magic(8) + len(2) + header + '\n'
  header = header + " ".repeat((64 - (unpadded % 64)) % 64) + "\n";

  const headerBytes = te.encode(header);
  const out = new Uint8Array(10 + headerBytes.length + count * src.data.BYTES_PER_ELEMENT);
  out.set([0x93, 0x4e, 0x55, 0x4d, 0x50, 0x59, 1, 0]); // \x93NUMPY v1.0
  new DataView(out.buffer).setUint16(8, headerBytes.length, true);
  out.set(headerBytes, 10);

  const dataStart = 10 + headerBytes.length;
  if (isLittleEndian || src.data.BYTES_PER_ELEMENT === 1) {
    out.set(new Uint8Array(src.data.buffer, src.data.byteOffset, src.data.byteLength), dataStart);
  } else {
    // big-endian host (rare): write element-wise as little-endian
    const dv = new DataView(out.buffer, dataStart);
    const bpe = src.data.BYTES_PER_ELEMENT;
    for (let i = 0; i < count; i++) {
      const v = src.data[i]!;
      if (bpe === 8) dv.setFloat64(i * 8, v, true);
      else if (src.dtype === "<f4") dv.setFloat32(i * 4, v, true);
      else if (src.dtype === "<i4") dv.setInt32(i * 4, v, true);
      else dv.setUint16(i * 2, v, true);
    }
  }
  return out;
}

/**
 * Build a .npz archive (zip of .npy entries). Entries are deflated by default —
 * depth/seg rasters compress 3-10×; pass `compress: false` for tiny archives.
 */
export async function buildNpz(
  arrays: Record<string, NpySource>,
  opts: { compress?: boolean } = {},
): Promise<ArrayBuffer> {
  const compress = opts.compress ?? true;
  const entries: ZipEntry[] = [];
  for (const [name, src] of Object.entries(arrays)) {
    const raw = encodeNpy(src);
    entries.push(compress ? await deflateEntry(`${name}.npy`, raw) : { name: `${name}.npy`, data: raw });
  }
  return buildZip(entries);
}
