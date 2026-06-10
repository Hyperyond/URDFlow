"use client";

import { useRef, useState, type ReactNode } from "react";
import type { RobotPreset } from "../lib/presets";

export interface MenuBarProps {
  robotLabel: string;
  presets: RobotPreset[];
  uploaded: { label: string }[];
  onPickPreset: (p: RobotPreset) => void;
  onPickFiles: (list: FileList) => void;
  onPickZip: (file: File) => void;
}

function MenuButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="relative">
      <button
        onClick={onClick}
        className={`rounded px-2 py-1 transition-colors ${
          active ? "bg-white/10 text-zinc-100" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
        }`}
      >
        {label}
      </button>
      {active && (
        <div className="absolute left-0 top-full z-30 mt-1 min-w-44 rounded-md border border-white/10 bg-[#13161c] py-1 shadow-xl">
          {children}
        </div>
      )}
    </div>
  );
}

export function MenuBar({ robotLabel, presets, uploaded, onPickPreset, onPickFiles, onPickZip }: MenuBarProps) {
  const [open, setOpen] = useState<string | null>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const zipRef = useRef<HTMLInputElement>(null);
  const toggle = (m: string) => setOpen((o) => (o === m ? null : m));

  return (
    <header className="relative z-20 flex h-10 items-center gap-1 border-b border-white/[0.06] bg-[#0c0e12] px-3 text-xs">
      <span className="mr-3 font-semibold tracking-tight text-zinc-100">URDFlow</span>

      {/* Import lives here as the "easter egg" under File */}
      <MenuButton label="File" active={open === "file"} onClick={() => toggle("file")}>
        <button
          onClick={() => {
            folderRef.current?.click();
            setOpen(null);
          }}
          className="block w-full px-3 py-1.5 text-left text-zinc-300 hover:bg-white/5"
        >
          导入机器人文件夹…
        </button>
        <button
          onClick={() => {
            zipRef.current?.click();
            setOpen(null);
          }}
          className="block w-full px-3 py-1.5 text-left text-zinc-300 hover:bg-white/5"
        >
          导入 .zip…
        </button>
      </MenuButton>

      <MenuButton label="Robot" active={open === "robot"} onClick={() => toggle("robot")}>
        {presets.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              onPickPreset(p);
              setOpen(null);
            }}
            className={`block w-full px-3 py-1.5 text-left hover:bg-white/5 ${
              robotLabel === p.name ? "text-accent" : "text-zinc-300"
            }`}
          >
            {p.name}
          </button>
        ))}
        {uploaded.map((u, i) => (
          <div key={`${u.label}-${i}`} className="px-3 py-1.5 text-zinc-500">
            {u.label} · uploaded
          </div>
        ))}
      </MenuButton>

      <span className="ml-auto font-mono text-zinc-500">{robotLabel}</span>

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
      <input
        ref={zipRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPickZip(f);
        }}
      />
    </header>
  );
}
