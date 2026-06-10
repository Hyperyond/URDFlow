import { unzip } from "fflate";
import type { URDFFileEntry } from "@urdflow/urdf-web";

/** From an <input webkitdirectory> / <input multiple> FileList. */
export async function entriesFromFileList(list: FileList): Promise<URDFFileEntry[]> {
  const files = Array.from(list);
  return Promise.all(
    files.map(async (f) => ({
      path: (f as File & { webkitRelativePath?: string }).webkitRelativePath || f.name,
      data: await f.arrayBuffer(),
    })),
  );
}

/** Unzip raw zip bytes into entries (pure; unit-tested). */
export function unzipEntries(data: Uint8Array): Promise<URDFFileEntry[]> {
  return new Promise<URDFFileEntry[]>((resolve, reject) => {
    unzip(data, (err, files) => {
      if (err) return reject(err);
      const entries: URDFFileEntry[] = [];
      for (const [path, bytes] of Object.entries(files)) {
        if (path.endsWith("/") || bytes.byteLength === 0) continue; // skip dirs
        entries.push({ path, data: bytes.slice().buffer as ArrayBuffer });
      }
      resolve(entries);
    });
  });
}

/** Unzip an uploaded .zip File into entries. */
export async function entriesFromZip(file: File): Promise<URDFFileEntry[]> {
  return unzipEntries(new Uint8Array(await file.arrayBuffer()));
}

/** Recursively read a dropped directory (Chromium webkitGetAsEntry). */
export async function entriesFromDataTransfer(items: DataTransferItemList): Promise<URDFFileEntry[]> {
  const roots: unknown[] = [];
  for (let i = 0; i < items.length; i++) {
    const entry = (items[i] as unknown as { webkitGetAsEntry?: () => unknown }).webkitGetAsEntry?.();
    if (entry) roots.push(entry);
  }
  const out: URDFFileEntry[] = [];
  async function walk(entry: any, prefix: string): Promise<void> {
    if (entry.isFile) {
      const file: File = await new Promise((res, rej) => entry.file(res, rej));
      if (file.name.toLowerCase().endsWith(".zip")) {
        out.push(...(await entriesFromZip(file)));
      } else {
        out.push({ path: prefix + entry.name, data: await file.arrayBuffer() });
      }
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const children: any[] = await new Promise((res, rej) => reader.readEntries(res, rej));
      for (const c of children) await walk(c, prefix + entry.name + "/");
    }
  }
  for (const r of roots) await walk(r, "");
  return out;
}
