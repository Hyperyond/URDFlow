import URDFLoader from "urdf-loader";
import type { URDFRobot } from "urdf-loader";
import { LoadingManager } from "three";
import type { LoadURDFOptions } from "./types";
import { applyZUpToYUp } from "./coordinates";
import { buildFileMap, findURDF } from "./fileMap";
import { createFileMeshLoader } from "./meshLoader";
import type { URDFFileEntry } from "./types";

function makeLoader(options: LoadURDFOptions): URDFLoader {
  const manager = new LoadingManager();
  if (options.onProgress) {
    manager.onProgress = (_url, loaded, total) => options.onProgress!(loaded, total);
  }
  const loader = new URDFLoader(manager);
  // urdf-loader's `packages` accepts string | map | resolver fn at runtime;
  // its bundled types are narrower, so cast the assignment.
  if (options.packages !== undefined) loader.packages = options.packages as never;
  if (options.loadMeshCb !== undefined) loader.loadMeshCb = options.loadMeshCb;
  return loader;
}

/** Parse URDF XML synchronously. Mesh geometry may still be loading after return. */
export function loadURDFFromString(
  content: string,
  options: LoadURDFOptions = {},
): URDFRobot {
  const robot = makeLoader(options).parse(content);
  if (options.convertUpAxis !== false) applyZUpToYUp(robot);
  return robot;
}

/** Load URDF from a URL; resolves once the robot tree is built. */
export function loadURDFFromURL(
  url: string,
  options: LoadURDFOptions = {},
): Promise<URDFRobot> {
  return new Promise((resolve, reject) => {
    makeLoader(options).load(
      url,
      (robot) => {
        if (options.convertUpAxis !== false) applyZUpToYUp(robot);
        resolve(robot);
      },
      undefined,
      (err) => reject(err),
    );
  });
}

const td = new TextDecoder();

/** Load a robot from uploaded in-memory files (folder/zip). Resolves mesh refs locally. */
export async function loadURDFFromFiles(
  entries: URDFFileEntry[],
  options: LoadURDFOptions & { urdfPath?: string } = {},
): Promise<URDFRobot> {
  const urdfEntry = findURDF(entries, options.urdfPath);
  const fm = buildFileMap(entries);
  const text = td.decode(urdfEntry.data);
  return loadURDFFromString(text, {
    ...options,
    // Mesh refs resolve against the uploaded file map, so package roots collapse to "".
    packages: options.packages ?? (() => ""),
    loadMeshCb: options.loadMeshCb ?? createFileMeshLoader(fm),
  });
}
