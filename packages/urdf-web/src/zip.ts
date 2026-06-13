/**
 * Minimal zip writer — zero dependencies, browser and Node 18+.
 * Entries are stored uncompressed by default (the payloads we bundle — .npz,
 * .png — are often already compressed). `deflateEntry` wraps raw data into a
 * method-8 entry for the payloads where compression pays off (depth/seg .npy).
 */

export interface ZipEntry {
  name: string;
  data: Uint8Array;
  /** Present only on entries produced by `deflateEntry` (data is deflate-raw). */
  method?: 0 | 8;
  /** CRC + size of the ORIGINAL data; required when method is 8. */
  crc?: number;
  uncompressedSize?: number;
}

/** Deflate-compress raw bytes into a zip entry (method 8). */
export async function deflateEntry(name: string, raw: Uint8Array): Promise<ZipEntry> {
  const ds = new CompressionStream("deflate-raw");
  const writer = ds.writable.getWriter();
  void writer.write(raw.slice());
  void writer.close();
  const data = new Uint8Array(await new Response(ds.readable as ReadableStream<Uint8Array>).arrayBuffer());
  return { name, data, method: 8, crc: crc32(raw), uncompressedSize: raw.length };
}

export function crc32(bytes: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc ^= bytes[i]!;
    for (let k = 0; k < 8; k++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const te = new TextEncoder();

/** Build a stored-only zip archive. */
export function buildZip(entries: ZipEntry[]): ArrayBuffer {
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = te.encode(e.name);
    const method = e.method ?? 0;
    const crc = method === 8 ? e.crc! : crc32(e.data);
    const rawSize = method === 8 ? e.uncompressedSize! : e.data.length;

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);
    lv.setUint16(4, 20, true); // version needed
    lv.setUint16(8, method, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, e.data.length, true);
    lv.setUint32(22, rawSize, true);
    lv.setUint16(26, name.length, true);
    local.set(name, 30);

    const cent = new Uint8Array(46 + name.length);
    const cv = new DataView(cent.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(10, method, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, e.data.length, true);
    cv.setUint32(24, rawSize, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cent.set(name, 46);
    central.push(cent);

    chunks.push(local, e.data);
    offset += local.length + e.data.length;
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
