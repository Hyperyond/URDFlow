/**
 * Minimal .npz / .npy reader — zero dependencies, runs in browser and Node 18+.
 *
 * Scope: what robot-trajectory archives actually use — zip entries that are
 * stored or deflated, .npy v1-3 with little-endian numeric dtypes, C order.
 * ZIP64 archives (>4 GB or >65k entries) are rejected explicitly.
 */

export interface NpyArray {
  shape: number[];
  dtype: string;
  /** Flat C-order data. int64 is converted to number (throws beyond 2^53). */
  data: Float64Array | Float32Array | Int32Array | Uint16Array | Uint8Array;
}

const te = new TextDecoder("utf-8");
const u16 = (b: DataView, o: number): number => b.getUint16(o, true);
const u32 = (b: DataView, o: number): number => b.getUint32(o, true);

async function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  const ds = new DecompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  void writer.write(bytes.slice());
  void writer.close();
  return new Uint8Array(await new Response(ds.readable as ReadableStream<Uint8Array>).arrayBuffer());
}

/** Parse one .npy buffer into a typed array + shape. */
export function parseNpy(buf: Uint8Array): NpyArray {
  if (buf[0] !== 0x93 || te.decode(buf.subarray(1, 6)) !== "NUMPY") {
    throw new Error("not a .npy file");
  }
  const major = buf[6]!;
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const headerLen = major >= 2 ? u32(view, 8) : u16(view, 8);
  const headerStart = major >= 2 ? 12 : 10;
  const header = te.decode(buf.subarray(headerStart, headerStart + headerLen));

  const descr = /'descr':\s*'([^']+)'/.exec(header)?.[1];
  const fortran = /'fortran_order':\s*(True|False)/.exec(header)?.[1];
  const shapeStr = /'shape':\s*\(([^)]*)\)/.exec(header)?.[1];
  if (!descr || !fortran || shapeStr === undefined) {
    throw new Error(`unparseable .npy header: ${header}`);
  }
  if (fortran === "True") throw new Error("fortran_order arrays not supported");
  const shape = shapeStr
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((s) => Number(s));
  const count = shape.reduce((a, b) => a * b, 1);

  const dataStart = headerStart + headerLen;
  const data = buf.subarray(dataStart);
  // copy into an aligned buffer — subarray offsets are rarely 8-byte aligned
  const aligned = (n: number): ArrayBuffer => {
    const out = new ArrayBuffer(n);
    new Uint8Array(out).set(data.subarray(0, n));
    return out;
  };
  switch (descr) {
    case "<f8":
      return { shape, dtype: descr, data: new Float64Array(aligned(count * 8)) };
    case "<f4":
      return { shape, dtype: descr, data: new Float32Array(aligned(count * 4)) };
    case "<i4":
      return { shape, dtype: descr, data: new Int32Array(aligned(count * 4)) };
    case "<u2":
      return { shape, dtype: descr, data: new Uint16Array(aligned(count * 2)) };
    case "|u1":
      return { shape, dtype: descr, data: new Uint8Array(aligned(count)) };
    case "<i8": {
      const big = new BigInt64Array(aligned(count * 8));
      const out = new Float64Array(count);
      for (let i = 0; i < count; i++) {
        const v = big[i]!;
        if (v > 9007199254740991n || v < -9007199254740991n) throw new Error("int64 exceeds safe integer");
        out[i] = Number(v);
      }
      return { shape, dtype: descr, data: out };
    }
    default:
      throw new Error(`unsupported dtype: ${descr}`);
  }
}

/** Parse a .npz archive (zip of .npy files) into name → array. */
export async function parseNpz(buffer: ArrayBuffer): Promise<Record<string, NpyArray>> {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // locate End Of Central Directory (scan backwards through possible comment)
  let eocd = -1;
  const scanFrom = Math.max(0, bytes.length - 22 - 65535);
  for (let i = bytes.length - 22; i >= scanFrom; i--) {
    if (u32(view, i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip archive (no end-of-central-directory)");
  const entryCount = u16(view, eocd + 10);
  const cdOffset = u32(view, eocd + 16);
  if (cdOffset === 0xffffffff) throw new Error("ZIP64 archives not supported");

  const out: Record<string, NpyArray> = {};
  let p = cdOffset;
  for (let e = 0; e < entryCount; e++) {
    if (u32(view, p) !== 0x02014b50) throw new Error("corrupt central directory");
    const method = u16(view, p + 10);
    const compSize = u32(view, p + 20);
    const nameLen = u16(view, p + 28);
    const extraLen = u16(view, p + 30);
    const commentLen = u16(view, p + 32);
    const localOffset = u32(view, p + 42);
    const name = te.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;

    // local header carries its own (possibly different) name/extra lengths
    if (u32(view, localOffset) !== 0x04034b50) throw new Error("corrupt local header");
    const lNameLen = u16(view, localOffset + 26);
    const lExtraLen = u16(view, localOffset + 28);
    const dataStart = localOffset + 30 + lNameLen + lExtraLen;
    const raw = bytes.subarray(dataStart, dataStart + compSize);

    let inflated: Uint8Array;
    if (method === 0) inflated = raw;
    else if (method === 8) inflated = await inflateRaw(raw);
    else throw new Error(`unsupported zip compression method ${method}`);

    const key = name.endsWith(".npy") ? name.slice(0, -4) : name;
    out[key] = parseNpy(inflated);
  }
  return out;
}
