import { describe, it, expect } from "vitest";
import { PerspectiveCamera, Vector3, Matrix4 } from "three";
import {
  intrinsicsFromFov,
  fovFromIntrinsics,
  projectionFromIntrinsics,
  projectPoint,
} from "../src/intrinsics";

describe("intrinsicsFromFov / fovFromIntrinsics", () => {
  it("round-trips fov exactly", () => {
    for (const fov of [30, 50, 58, 90]) {
      expect(fovFromIntrinsics(intrinsicsFromFov(fov, 256, 256))).toBeCloseTo(fov, 10);
    }
  });

  it("non-square images keep square pixels (fx === fy from vertical fov)", () => {
    const k = intrinsicsFromFov(60, 640, 480);
    expect(k.fx).toBe(k.fy);
    expect(k.cx).toBe(320);
    expect(k.cy).toBe(240);
  });
});

describe("projectionFromIntrinsics", () => {
  it("matches three.js PerspectiveCamera for a centered principal point", () => {
    const fov = 50;
    const cam = new PerspectiveCamera(fov, 640 / 480, 0.01, 100);
    cam.updateProjectionMatrix();
    const ours = projectionFromIntrinsics(intrinsicsFromFov(fov, 640, 480), 0.01, 100);
    cam.projectionMatrix.toArray().forEach((v, i) => expect(ours[i]).toBeCloseTo(v, 10));
  });

  it("agrees with the pinhole model for an off-center principal point", () => {
    const k = { width: 640, height: 480, fx: 500, fy: 510, cx: 300, cy: 260 };
    const m = new Matrix4().fromArray(projectionFromIntrinsics(k, 0.01, 100));
    for (const [x, y, z] of [
      [0.2, -0.1, -1],
      [-0.4, 0.3, -2.5],
      [0, 0, -0.5],
    ] as const) {
      const ndc = new Vector3(x, y, z).applyMatrix4(m);
      const u = ((ndc.x + 1) * k.width) / 2;
      const v = ((1 - ndc.y) * k.height) / 2; // image v runs down
      const [pu, pv] = projectPoint(k, x, y, z);
      expect(u).toBeCloseTo(pu, 8);
      expect(v).toBeCloseTo(pv, 8);
    }
  });

  it("principal point at the exact center projects the optical axis to (cx, cy)", () => {
    const k = intrinsicsFromFov(58, 256, 256);
    const [u, v] = projectPoint(k, 0, 0, -1.7);
    expect(u).toBe(128);
    expect(v).toBe(128);
  });
});
