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
  /** Base dir (string), name→path map, or resolver fn for `package://` mesh paths. */
  packages?: string | Record<string, string> | ((targetPkg: string) => string);
  /** Custom mesh loader, forwarded to urdf-loader's loadMeshCb. */
  loadMeshCb?: (
    path: string,
    manager: LoadingManager,
    onComplete: (obj: Object3D, err?: Error) => void,
  ) => void;
  /** Convert URDF Z-up to three.js Y-up. Default: true. */
  convertUpAxis?: boolean;
  /** Progress callback wired to the three.js LoadingManager. */
  onProgress?: (loaded: number, total: number) => void;
}

/** One in-browser file from an uploaded robot (folder or unzipped). */
export interface URDFFileEntry {
  /** Path relative to the upload root, e.g. "ur5/meshes/visual/base.dae". */
  path: string;
  data: ArrayBuffer;
}
