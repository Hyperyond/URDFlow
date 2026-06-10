import type { URDFFileEntry } from "./types";

export interface FileMap {
  byPath: Map<string, URDFFileEntry>;
  byBasename: Map<string, URDFFileEntry[]>;
}

/** Normalize a path: backslashes → "/", strip a leading "./" or "/". */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/^\.?\//, "");
}

export function basename(p: string): string {
  const n = normalizePath(p);
  const i = n.lastIndexOf("/");
  return i === -1 ? n : n.slice(i + 1);
}

export function buildFileMap(entries: URDFFileEntry[]): FileMap {
  const byPath = new Map<string, URDFFileEntry>();
  const byBasename = new Map<string, URDFFileEntry[]>();
  for (const entry of entries) {
    const path = normalizePath(entry.path);
    const normalized: URDFFileEntry = { path, data: entry.data };
    byPath.set(path, normalized);
    const base = basename(path);
    const list = byBasename.get(base) ?? [];
    list.push(normalized);
    byBasename.set(base, list);
  }
  return { byPath, byBasename };
}

/** Pick the .urdf entry to load (explicit urdfPath wins; else first .urdf). */
export function findURDF(
  entries: URDFFileEntry[],
  urdfPath?: string,
): URDFFileEntry {
  const urdfs = entries.filter((x) => /\.urdf$/i.test(x.path));
  if (urdfs.length === 0) throw new Error("No .urdf file found in upload.");
  if (urdfPath) {
    const want = normalizePath(urdfPath);
    const hit = urdfs.find((x) => normalizePath(x.path) === want);
    if (hit) return hit;
  }
  return urdfs[0]!;
}

/** Resolve a URDF mesh reference (package:// or relative) to an uploaded entry. */
export function resolveMeshRef(ref: string, fm: FileMap): URDFFileEntry | null {
  const stripped = normalizePath(ref.replace(/^package:\/\/[^/]+\//, ""));
  // 1) exact normalized path
  const exact = fm.byPath.get(stripped);
  if (exact) return exact;
  // 2) suffix match (some entry path ends with the stripped ref)
  for (const [path, entry] of fm.byPath) {
    if (path === stripped || path.endsWith("/" + stripped)) return entry;
  }
  // 3) basename match (first winner)
  const byBase = fm.byBasename.get(basename(stripped));
  if (byBase && byBase.length >= 1) return byBase[0]!;
  return null;
}
