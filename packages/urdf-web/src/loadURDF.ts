import URDFLoader from "urdf-loader";
import type { URDFRobot } from "urdf-loader";
import { LoadingManager } from "three";
import type { LoadURDFOptions } from "./types";
import { applyZUpToYUp } from "./coordinates";

function makeLoader(options: LoadURDFOptions): URDFLoader {
  const loader = new URDFLoader(new LoadingManager());
  if (options.packages !== undefined) loader.packages = options.packages;
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
