/**
 * Gathers what the physics compiler needs from either robot source: the raw
 * URDF text plus the bytes of every collision mesh the MJCF references.
 * Presets resolve mesh paths relative to the URDF's URL; uploads resolve
 * through the in-memory file map.
 */

import {
  buildFileMap,
  findURDF,
  resolveMeshRef,
  type MJCFMeshRef,
  type URDFFileEntry,
} from "@urdflow/urdf-web";

export type RobotSourceRef =
  | { kind: "preset"; url: string }
  | { kind: "files"; entries: URDFFileEntry[] };

export interface RobotPhysicsFiles {
  urdfText: string;
  /** Fetch one URDF-referenced mesh (raw filename attr) as bytes. */
  resolveMesh: (path: string) => Promise<ArrayBuffer>;
}

const td = new TextDecoder();

export async function collectRobotFiles(source: RobotSourceRef): Promise<RobotPhysicsFiles> {
  if (source.kind === "preset") {
    const res = await fetch(source.url);
    if (!res.ok) throw new Error(`fetch ${source.url}: ${res.status}`);
    const urdfText = await res.text();
    const base = source.url.slice(0, source.url.lastIndexOf("/") + 1);
    return {
      urdfText,
      resolveMesh: async (path) => {
        // package://pkg/… falls back to stripping the scheme; presets use relative paths
        const rel = path.replace(/^package:\/\/[^/]+\//, "").replace(/^\.\//, "");
        const r = await fetch(base + rel);
        if (!r.ok) throw new Error(`mesh ${base + rel}: ${r.status}`);
        return r.arrayBuffer();
      },
    };
  }

  const map = buildFileMap(source.entries);
  const urdfEntry = findURDF(source.entries);
  return {
    urdfText: td.decode(urdfEntry.data),
    resolveMesh: async (path) => {
      const hit = resolveMeshRef(path, map);
      if (!hit) throw new Error(`mesh not found in upload: ${path}`);
      return hit.data;
    },
  };
}

/** Resolve every compiler-referenced mesh into {file, buf} pairs for the worker FS. */
export async function collectMeshAssets(
  meshes: MJCFMeshRef[],
  files: RobotPhysicsFiles,
): Promise<{ file: string; buf: ArrayBuffer }[]> {
  return Promise.all(
    meshes.map(async (m) => ({ file: m.file, buf: await files.resolveMesh(m.path) })),
  );
}
