import { Group, Mesh, MeshStandardMaterial, type LoadingManager, type Object3D } from "three";
import { STLLoader } from "three/examples/jsm/loaders/STLLoader.js";
import { ColladaLoader } from "three/examples/jsm/loaders/ColladaLoader.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { resolveMeshRef, type FileMap } from "./fileMap";

const DEFAULT_MAT = new MeshStandardMaterial({ color: 0xb0b4bb, metalness: 0.35, roughness: 0.55 });
const decoder = new TextDecoder();

/**
 * A urdf-loader `loadMeshCb` that resolves meshes from in-memory uploaded files.
 * A single bad/missing mesh is skipped (empty Group) rather than failing the robot.
 */
export function createFileMeshLoader(fm: FileMap) {
  return function loadMeshCb(
    path: string,
    _manager: LoadingManager,
    done: (obj: Object3D, err?: Error) => void,
  ): void {
    const entry = resolveMeshRef(path, fm);
    if (!entry) {
      console.warn(`[urdf-web] mesh not found in upload: ${path}`);
      done(new Group());
      return;
    }
    try {
      if (/\.stl$/i.test(entry.path)) {
        const geometry = new STLLoader().parse(entry.data);
        done(new Mesh(geometry, DEFAULT_MAT));
      } else if (/\.dae$/i.test(entry.path)) {
        const collada = new ColladaLoader().parse(decoder.decode(entry.data), "");
        done(collada ? collada.scene : new Group());
      } else if (/\.obj$/i.test(entry.path)) {
        const group = new OBJLoader().parse(decoder.decode(entry.data));
        group.traverse((o) => {
          if (o instanceof Mesh) o.material = DEFAULT_MAT;
        });
        done(group);
      } else if (/\.(gltf|glb)$/i.test(entry.path)) {
        new GLTFLoader().parse(
          entry.data,
          "",
          (gltf) => done(gltf.scene),
          (err) => {
            console.warn(`[urdf-web] glTF parse failed: ${entry.path}`, err);
            done(new Group());
          },
        );
      } else {
        console.warn(`[urdf-web] unsupported mesh type: ${entry.path}`);
        done(new Group());
      }
    } catch (err) {
      console.warn(`[urdf-web] mesh parse failed: ${entry.path}`, err);
      done(new Group());
    }
  };
}
