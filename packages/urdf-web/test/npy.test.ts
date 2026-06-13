import { describe, it, expect } from "vitest";
import { encodeNpy, buildNpz, type NpySource } from "../src/npy";
import { parseNpy, parseNpz } from "../src/npz";
import { buildZip, deflateEntry } from "../src/zip";

const CASES: NpySource[] = [
  { shape: [2, 3], dtype: "<f4", data: new Float32Array([1, -2.5, 3.25, 0, 1e-3, 7]) },
  { shape: [4], dtype: "<f8", data: new Float64Array([Math.PI, -1, 0, 1e12]) },
  { shape: [2, 2], dtype: "<i4", data: new Int32Array([-7, 0, 65536, 2 ** 31 - 1]) },
  { shape: [2, 2, 2], dtype: "<u2", data: new Uint16Array([0, 1, 1000, 65535, 42, 7, 8, 9]) },
  { shape: [3, 3], dtype: "|u1", data: new Uint8Array([0, 1, 2, 3, 4, 5, 254, 255, 128]) },
];

describe("encodeNpy", () => {
  it("round-trips every dtype through parseNpy", () => {
    for (const src of CASES) {
      const parsed = parseNpy(encodeNpy(src));
      expect(parsed.dtype).toBe(src.dtype);
      expect(parsed.shape).toEqual(src.shape);
      expect(Array.from(parsed.data)).toEqual(Array.from(src.data));
    }
  });

  it("pads the header so data starts on a 64-byte boundary", () => {
    for (const src of CASES) {
      const buf = encodeNpy(src);
      const headerLen = new DataView(buf.buffer).getUint16(8, true);
      expect((10 + headerLen) % 64).toBe(0);
    }
  });

  it("rejects shape/data mismatches", () => {
    expect(() => encodeNpy({ shape: [3], dtype: "<f4", data: new Float32Array(2) })).toThrow(/elements/);
  });
});

describe("buildNpz", () => {
  it("round-trips a multi-array archive (deflated)", async () => {
    const arrays = Object.fromEntries(CASES.map((c, i) => [`arr_${i}`, c]));
    const parsed = await parseNpz(await buildNpz(arrays));
    for (const [name, src] of Object.entries(arrays)) {
      expect(parsed[name]!.shape).toEqual(src.shape);
      expect(Array.from(parsed[name]!.data)).toEqual(Array.from(src.data));
    }
  });

  it("round-trips uncompressed too", async () => {
    const parsed = await parseNpz(await buildNpz({ a: CASES[0]! }, { compress: false }));
    expect(Array.from(parsed.a!.data)).toEqual(Array.from(CASES[0]!.data));
  });

  it("deflated archives are smaller than stored for repetitive rasters", async () => {
    const depth: NpySource = { shape: [64, 64], dtype: "<u2", data: new Uint16Array(64 * 64).fill(1234) };
    const small = await buildNpz({ depth });
    const big = await buildNpz({ depth }, { compress: false });
    expect(small.byteLength).toBeLessThan(big.byteLength / 4);
  });
});

describe("zip deflate entries", () => {
  it("mixes stored and deflated entries in one archive", async () => {
    const npy = encodeNpy(CASES[4]!);
    const zip = buildZip([{ name: "stored.npy", data: npy }, await deflateEntry("packed.npy", npy)]);
    // parseNpz handles method 0 and 8 — both entries must decode identically
    const parsed = await parseNpz(zip);
    expect(Array.from(parsed.stored!.data)).toEqual(Array.from(parsed.packed!.data));
  });
});
