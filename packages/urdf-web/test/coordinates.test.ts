import { describe, it, expect } from "vitest";
import { Object3D, Vector3 } from "three";
import { applyZUpToYUp } from "../src/coordinates";

describe("applyZUpToYUp", () => {
  it("maps URDF +Z (up) onto three.js +Y (up)", () => {
    const obj = new Object3D();
    applyZUpToYUp(obj);
    const up = new Vector3(0, 0, 1).applyQuaternion(obj.quaternion);
    expect(up.x).toBeCloseTo(0, 5);
    expect(up.y).toBeCloseTo(1, 5);
    expect(up.z).toBeCloseTo(0, 5);
  });

  it("maps URDF +X onto three.js +X (unchanged)", () => {
    const obj = new Object3D();
    applyZUpToYUp(obj);
    const x = new Vector3(1, 0, 0).applyQuaternion(obj.quaternion);
    expect(x.x).toBeCloseTo(1, 5);
    expect(x.y).toBeCloseTo(0, 5);
    expect(x.z).toBeCloseTo(0, 5);
  });
});
