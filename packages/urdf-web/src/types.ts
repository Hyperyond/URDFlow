import type { Object3D, LoadingManager } from "three";

export type URDFJointType =
  | "fixed"
  | "continuous"
  | "revolute"
  | "prismatic"
  | "planar"
  | "floating";

/** Flattened, UI-friendly description of one movable joint. */
export interface JointInfo {
  name: string;
  type: URDFJointType;
  lower: number;
  upper: number;
}

export interface LoadURDFOptions {
  /** Base dir (string) or name→path map for resolving `package://` mesh paths. */
  packages?: string | Record<string, string>;
  /** Custom mesh loader, forwarded to urdf-loader's loadMeshCb. */
  loadMeshCb?: (
    path: string,
    manager: LoadingManager,
    onComplete: (obj: Object3D, err?: Error) => void,
  ) => void;
  /** Convert URDF Z-up to three.js Y-up. Default: true. */
  convertUpAxis?: boolean;
}
