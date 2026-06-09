"use client";

import type { JointInfo } from "@urdflow/urdf-web";

export interface JointPanelProps {
  model: JointInfo[];
  values: Record<string, number>;
  onChange: (name: string, value: number) => void;
}

export function JointPanel({ model, values, onChange }: JointPanelProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: 16 }}>
      {model.map((j) => (
        <label key={j.name} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <span style={{ width: 80 }}>{j.name}</span>
          <input
            type="range"
            min={j.lower}
            max={j.upper}
            step={0.01}
            value={values[j.name] ?? 0}
            onChange={(e) => onChange(j.name, Number(e.target.value))}
          />
          <span style={{ width: 48 }}>{(values[j.name] ?? 0).toFixed(2)}</span>
        </label>
      ))}
    </div>
  );
}
