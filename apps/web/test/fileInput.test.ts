import { describe, it, expect } from "vitest";
import { zipSync, strToU8 } from "fflate";
import { unzipEntries } from "../lib/fileInput";

describe("unzipEntries", () => {
  it("unzips a robot archive into URDFFileEntry[]", async () => {
    const zipped = zipSync({
      "robot/arm.urdf": strToU8("<robot name='a'></robot>"),
      "robot/meshes/base.stl": new Uint8Array([1, 2, 3]),
    });
    const entries = await unzipEntries(zipped);
    const paths = entries.map((e) => e.path).sort();
    expect(paths).toEqual(["robot/arm.urdf", "robot/meshes/base.stl"]);
    expect(entries.find((e) => e.path.endsWith(".stl"))!.data.byteLength).toBe(3);
  });
});
