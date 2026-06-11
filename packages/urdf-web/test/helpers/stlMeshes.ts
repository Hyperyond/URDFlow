import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Mesh, MeshStandardMaterial, type Object3D, type LoadingManager } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";

/**
 * Synchronous STL mesh loader for tests: resolves mesh refs against the robot's
 * folder on disk, so gripper-geometry code paths run with real fingers.
 */
export function stlMeshLoaderFor(robotDir: string) {
  const loader = new STLLoader();
  return (path: string, _m: LoadingManager, done: (obj: Object3D, err?: Error) => void): void => {
    try {
      const buf = readFileSync(resolve(robotDir, path));
      const geom = loader.parse(
        buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer,
      );
      done(new Mesh(geom, new MeshStandardMaterial()));
    } catch (e) {
      done(new Mesh(), e instanceof Error ? e : new Error(String(e)));
    }
  };
}
