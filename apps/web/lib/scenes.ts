import { clampScene, type SceneSpec } from "./sceneTypes";

export type SceneKind = "assembly" | "sorting" | "logistics";

export const SCENE_PRESETS: { kind: SceneKind; name: string }[] = [
  { kind: "assembly", name: "Assembly line" },
  { kind: "sorting", name: "Sorting" },
  { kind: "logistics", name: "Logistics" },
];

const rot = (x: number, z: number, a: number): [number, number] => [
  x * Math.cos(a) - z * Math.sin(a),
  x * Math.sin(a) + z * Math.cos(a),
];

/**
 * Generate a preset scene anchored to the robot's workspace: `anchor` is the ground
 * point under the gripper's ready hover, so the layout lands inside any model's reach.
 */
export function buildScene(kind: SceneKind, anchor: { x: number; z: number; radius: number }): SceneSpec {
  const { x, z, radius } = anchor;
  // tangent direction (perpendicular to the base→anchor ray) for laying out rows
  const len = Math.hypot(x, z) || 1;
  const tx = -z / len;
  const tz = x / len;
  let scene: SceneSpec;
  switch (kind) {
    case "assembly": {
      // conveyor: three cubes in a row feed one drop-off row on the other side
      scene = {
        cubes: [-1, 0, 1].map((i) => ({ x: x + tx * 0.1 * i, z: z + tz * 0.1 * i })),
        targets: [-1, 0, 1].map((i) => {
          const [rx, rz] = rot(x + tx * 0.1 * i, z + tz * 0.1 * i, 0.85);
          return { x: rx, z: rz };
        }),
      };
      break;
    }
    case "sorting": {
      // colored pile in front, one bin per color fanned around the base
      const colors = ["#f87171", "#4ade80", "#60a5fa"];
      scene = {
        cubes: colors.map((color, i) => ({
          x: x + tx * 0.08 * (i - 1) - (x / len) * 0.02 * i,
          z: z + tz * 0.08 * (i - 1) - (z / len) * 0.02 * i,
          color,
        })),
        targets: [0.55, 0.9, 1.25].map((a) => {
          const [rx, rz] = rot(x, z, a);
          return { x: rx, z: rz };
        }),
      };
      break;
    }
    case "logistics": {
      // 2×2 pallet of boxes moved to a mirrored 2×2 staging area
      const grid = [
        [-0.5, -0.5],
        [0.5, -0.5],
        [-0.5, 0.5],
        [0.5, 0.5],
      ] as const;
      const rad = (x / len) * 0.05;
      const radZ = (z / len) * 0.05;
      scene = {
        cubes: grid.map(([u, v]) => ({
          x: x + tx * 0.09 * u + rad * v,
          z: z + tz * 0.09 * u + radZ * v,
          color: "#fbbf24",
        })),
        targets: grid.map(([u, v]) => {
          const [rx, rz] = rot(x + tx * 0.09 * u + rad * v, z + tz * 0.09 * u + radZ * v, 1.0);
          return { x: rx, z: rz };
        }),
      };
      break;
    }
  }
  return clampScene(scene, radius);
}
