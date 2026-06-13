/**
 * Pinhole camera intrinsics ⇄ GL projection — the bridge between a training
 * pipeline's K matrix (OpenCV convention: u right, v down, origin top-left)
 * and the three.js/OpenGL camera that renders the frames.
 *
 * Conventions: camera looks down -Z with +Y up (OpenGL). A point at view-space
 * (x, y, z) projects to pixel u = fx·x/(-z) + cx, v = -fy·y/(-z) + cy.
 */

export interface CameraIntrinsics {
  width: number;
  height: number;
  fx: number;
  fy: number;
  cx: number;
  cy: number;
}

/** K for a centered square-pixel camera with the given VERTICAL fov (degrees). */
export function intrinsicsFromFov(fovDeg: number, width: number, height: number): CameraIntrinsics {
  const f = height / 2 / Math.tan((fovDeg * Math.PI) / 360);
  return { width, height, fx: f, fy: f, cx: width / 2, cy: height / 2 };
}

/** Vertical fov (degrees) implied by K — exact inverse of intrinsicsFromFov. */
export function fovFromIntrinsics(k: CameraIntrinsics): number {
  return (Math.atan(k.height / 2 / k.fy) * 360) / Math.PI;
}

/**
 * Column-major 4×4 OpenGL projection matrix realizing K (off-axis when the
 * principal point is off-center). Assign to camera.projectionMatrix directly.
 */
export function projectionFromIntrinsics(k: CameraIntrinsics, near: number, far: number): number[] {
  const m = new Array<number>(16).fill(0);
  m[0] = (2 * k.fx) / k.width;
  m[5] = (2 * k.fy) / k.height;
  m[8] = 1 - (2 * k.cx) / k.width;
  m[9] = (2 * k.cy) / k.height - 1;
  m[10] = -(far + near) / (far - near);
  m[11] = -1;
  m[14] = (-2 * far * near) / (far - near);
  return m;
}

/** Project a view-space point to pixel coords through K (z must be negative). */
export function projectPoint(k: CameraIntrinsics, x: number, y: number, z: number): [number, number] {
  return [(k.fx * x) / -z + k.cx, (-k.fy * y) / -z + k.cy];
}
