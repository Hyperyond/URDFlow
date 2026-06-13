import { describe, it, expect } from "vitest";
import { Mesh, Object3D, Scene, BoxGeometry, MeshStandardMaterial } from "three";
import {
  flipToRGB,
  depthToMM,
  segToIds,
  segLabelFor,
  segMaterial,
  buildSegAssignments,
} from "../lib/sensorCapture";

describe("readback conversions", () => {
  it("flipToRGB flips rows and strips alpha", () => {
    // 1×2 image, bottom-up RGBA: row0=(1,2,3,255) row1=(4,5,6,255)
    const src = new Uint8Array([1, 2, 3, 255, 4, 5, 6, 255]);
    // top-down RGB: first output row must be the LAST source row
    expect(Array.from(flipToRGB(src, 1, 2))).toEqual([4, 5, 6, 1, 2, 3]);
  });

  it("depthToMM converts meters→mm, clamps, zeroes negatives", () => {
    const src = new Float32Array(4 * 4);
    src[0] = 1.2345; // bottom row → output row 1
    src[4] = 70; // beyond uint16 range in meters
    src[8] = 0; // background (cleared to 0) → "no return"
    src[12] = -1; // never happens, but must not wrap
    const mm = depthToMM(src, 2, 2);
    expect(Array.from(mm)).toEqual([0, 0, 1235, 65535]);
  });

  it("segToIds picks the red byte and flips rows", () => {
    const src = new Uint8Array([7, 0, 0, 255, 9, 0, 0, 255]); // 1×2 bottom-up
    expect(Array.from(segToIds(src, 1, 2))).toEqual([9, 7]);
  });
});

describe("segmentation labeling", () => {
  it("labels by URDF link, explicit tag, or env fallback", () => {
    const link = new Object3D();
    (link as unknown as { isURDFLink: boolean }).isURDFLink = true;
    link.name = "wrist_3";
    const linkMesh = new Mesh();
    link.add(linkMesh);
    expect(segLabelFor(linkMesh)).toBe("link:wrist_3");

    const tagged = new Object3D();
    tagged.userData.segName = "object:cube-1";
    const cubeMesh = new Mesh();
    tagged.add(cubeMesh);
    expect(segLabelFor(cubeMesh)).toBe("object:cube-1");

    expect(segLabelFor(new Mesh())).toBe("env");
  });

  it("buildSegAssignments assigns stable ids and only sees the capture layer", () => {
    const scene = new Scene();
    const onLayer = (m: Mesh, seg?: string) => {
      m.layers.enable(1);
      if (seg) m.userData.segName = seg;
      scene.add(m);
      return m;
    };
    const ground = onLayer(new Mesh(new BoxGeometry(), new MeshStandardMaterial()), "ground");
    const cube = onLayer(new Mesh(new BoxGeometry(), new MeshStandardMaterial()), "object:c1");
    const helper = new Mesh(new BoxGeometry(), new MeshStandardMaterial()); // layer 0 only
    scene.add(helper);

    const labels = ["background"];
    const a = buildSegAssignments(scene, 1, labels);
    expect(a.map((x) => x.mesh)).toEqual([ground, cube]);
    expect(labels).toEqual(["background", "ground", "object:c1"]);
    // second pass reuses ids — no label churn between frames
    const b = buildSegAssignments(scene, 1, labels);
    expect(b.map((x) => x.id)).toEqual(a.map((x) => x.id));
  });

  it("segMaterial encodes the id exactly in the red byte and caches", () => {
    const m = segMaterial(42);
    expect(Math.round(m.color.r * 255)).toBe(42);
    expect(m.toneMapped).toBe(false);
    expect(segMaterial(42)).toBe(m);
  });
});
