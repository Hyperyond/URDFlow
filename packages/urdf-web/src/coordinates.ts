import type { Object3D } from "three";

/**
 * URDF uses a Z-up right-handed frame; three.js uses Y-up.
 * Rotating the robot root -90° about X maps URDF +Z onto three.js +Y.
 */
export function applyZUpToYUp(robot: Object3D): void {
  robot.rotation.x = -Math.PI / 2;
  robot.updateMatrixWorld(true);
}
