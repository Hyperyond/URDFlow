"use client";

import type { JointInfo } from "@urdflow/urdf-web";

export interface JointPanelProps {
  model: JointInfo[];
  values: Record<string, number>;
  onChange: (name: string, value: number) => void;
  onReset: (name: string) => void;
  onResetAll: () => void;
}

export function JointPanel({ model, values, onChange, onReset, onResetAll }: JointPanelProps) {
  if (model.length === 0) return null;
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] uppercase tracking-wider text-zinc-500">Joints</h2>
        <button
          onClick={onResetAll}
          className="text-[11px] uppercase tracking-wider text-zinc-400 transition-colors hover:text-accent"
        >
          Reset all
        </button>
      </div>
      <div className="flex flex-col gap-3">
        {model.map((j) => {
          const v = values[j.name] ?? 0;
          return (
            <div key={j.name} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-300">{j.name}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono tabular-nums text-accent">{v.toFixed(2)}</span>
                  <button
                    aria-label={`reset joint ${j.name}`}
                    onClick={() => onReset(j.name)}
                    className="text-zinc-600 transition-colors hover:text-zinc-300"
                  >
                    ↺
                  </button>
                </div>
              </div>
              <input
                type="range"
                min={j.lower}
                max={j.upper}
                step={0.01}
                value={v}
                onChange={(e) => onChange(j.name, Number(e.target.value))}
                className="w-full"
              />
              <div className="flex justify-between font-mono text-[10px] text-zinc-600">
                <span>{j.lower.toFixed(2)}</span>
                <span>{j.upper.toFixed(2)}</span>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
