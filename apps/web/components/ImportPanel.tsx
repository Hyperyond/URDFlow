"use client";

import { useRef, useState } from "react";

export interface ImportPanelProps {
  onPickFiles: (list: FileList) => void;
  onPickZip: (file: File) => void;
  busy: boolean;
}

export function ImportPanel({ onPickFiles, onPickZip, busy }: ImportPanelProps) {
  const folderRef = useRef<HTMLInputElement>(null);
  const [drag, setDrag] = useState(false);

  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[11px] uppercase tracking-wider text-zinc-500">Import</h2>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          const dt = e.dataTransfer;
          const file = dt.files?.[0];
          if (file && file.name.toLowerCase().endsWith(".zip")) onPickZip(file);
          else if (dt.items?.length)
            (window as unknown as { __urdfDrop?: (i: DataTransferItemList) => void }).__urdfDrop?.(dt.items);
        }}
        onClick={() => folderRef.current?.click()}
        className={`cursor-pointer rounded-md border border-dashed px-3 py-6 text-center text-xs transition-colors ${
          drag
            ? "border-accent bg-accent/5 text-accent shadow-[0_0_12px_0_#22d3ee44]"
            : "border-white/10 text-zinc-500 hover:border-white/20"
        }`}
      >
        {busy ? "Loading…" : "拖入机器人文件夹 / .zip，或点击选择"}
      </div>
      <input
        ref={folderRef}
        data-testid="folder-input"
        type="file"
        // @ts-expect-error webkitdirectory is non-standard but supported in Chromium
        webkitdirectory=""
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files?.length) onPickFiles(e.target.files);
        }}
      />
    </section>
  );
}
