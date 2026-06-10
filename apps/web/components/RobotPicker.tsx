"use client";

import type { RobotPreset } from "../lib/presets";

export interface RobotPickerProps {
  presets: RobotPreset[];
  uploaded: { label: string }[];
  activeLabel: string;
  onPick: (preset: RobotPreset) => void;
}

export function RobotPicker({ presets, uploaded, activeLabel, onPick }: RobotPickerProps) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-[11px] uppercase tracking-wider text-zinc-500">Robots</h2>
      <div className="flex flex-col gap-1">
        {presets.map((p) => (
          <button
            key={p.id}
            onClick={() => onPick(p)}
            className={`rounded px-2 py-1.5 text-left text-xs transition-colors ${
              activeLabel === p.name
                ? "bg-accent/10 text-accent"
                : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
            }`}
          >
            {p.name}
          </button>
        ))}
        {uploaded.map((u, i) => (
          <div
            key={`${u.label}-${i}`}
            className={`cursor-default rounded px-2 py-1.5 text-xs ${
              activeLabel === u.label ? "bg-accent/10 text-accent" : "text-zinc-400"
            }`}
          >
            {u.label} <span className="text-zinc-600">· uploaded</span>
          </div>
        ))}
      </div>
    </section>
  );
}
