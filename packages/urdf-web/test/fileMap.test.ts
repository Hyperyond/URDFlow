import { describe, it, expect } from "vitest";
import { buildFileMap, findURDF, resolveMeshRef } from "../src/fileMap";
import type { URDFFileEntry } from "../src/types";

const e = (path: string): URDFFileEntry => ({ path, data: new ArrayBuffer(1) });

describe("buildFileMap", () => {
  it("indexes entries by normalized path and by basename", () => {
    const fm = buildFileMap([e("ur5/meshes/visual/base.dae"), e("./ur5/robot.urdf")]);
    expect(fm.byPath.has("ur5/meshes/visual/base.dae")).toBe(true);
    expect(fm.byPath.has("ur5/robot.urdf")).toBe(true); // leading ./ normalized
    expect(fm.byBasename.get("base.dae")?.length).toBe(1);
  });

  it("records multiple entries sharing a basename", () => {
    const fm = buildFileMap([e("a/mesh.stl"), e("b/mesh.stl")]);
    expect(fm.byBasename.get("mesh.stl")?.length).toBe(2);
  });
});

describe("findURDF", () => {
  it("returns the sole .urdf entry", () => {
    expect(findURDF([e("meshes/base.dae"), e("robot/ur5.urdf")]).path).toBe("robot/ur5.urdf");
  });

  it("prefers an explicit urdfPath when several exist", () => {
    expect(findURDF([e("a.urdf"), e("sub/b.urdf")], "sub/b.urdf").path).toBe("sub/b.urdf");
  });

  it("throws when no .urdf is present", () => {
    expect(() => findURDF([e("meshes/base.dae")])).toThrow(/no \.urdf/i);
  });
});

describe("resolveMeshRef", () => {
  const fm = buildFileMap([e("ur5/meshes/visual/base.dae"), e("ur5/meshes/visual/wrist.dae")]);

  it("matches a relative ref exactly", () => {
    expect(resolveMeshRef("ur5/meshes/visual/base.dae", fm)?.path).toBe("ur5/meshes/visual/base.dae");
  });

  it("matches a package:// ref by suffix", () => {
    expect(resolveMeshRef("package://robot/ur5/meshes/visual/base.dae", fm)?.path).toBe(
      "ur5/meshes/visual/base.dae",
    );
  });

  it("falls back to basename match", () => {
    expect(resolveMeshRef("package://x/some/other/dir/wrist.dae", fm)?.path).toBe(
      "ur5/meshes/visual/wrist.dae",
    );
  });

  it("returns null when nothing matches", () => {
    expect(resolveMeshRef("package://x/nope.stl", fm)).toBeNull();
  });
});
