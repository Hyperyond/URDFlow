"use client";

import type { Actuator, JointSignal } from "@urdflow/urdf-web";

export interface SignalPanelProps {
  actuators: Actuator[];
  signals: JointSignal[];
  onHome: () => void;
  onStop: () => void;
}

function statusColor(s: JointSignal): string {
  if (s.atLowerLimit || s.atUpperLimit) return "#f87171"; // red — at limit
  if (s.moving) return "#22d3ee"; // accent — moving
  return "#4ade80"; // green — ready / at target
}
function statusWord(s: JointSignal): string {
  if (s.atLowerLimit || s.atUpperLimit) return "limit";
  if (s.moving) return "moving";
  return "ready";
}

export function SignalPanel({ actuators, signals, onHome, onStop }: SignalPanelProps) {
  if (signals.length === 0) return null;
  const byName = new Map(actuators.map((a) => [a.name, a]));
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] uppercase tracking-wider text-zinc-500">Signals</h2>
        <div className="flex gap-2">
          <button
            onClick={onHome}
            className="text-[11px] uppercase tracking-wider text-zinc-400 transition-colors hover:text-accent"
          >
            Home
          </button>
          <button
            onClick={onStop}
            className="text-[11px] uppercase tracking-wider text-zinc-400 transition-colors hover:text-red-400"
          >
            Stop
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        {signals.map((s) => {
          const a = byName.get(s.name);
          return (
            <div key={s.name} className="flex items-center justify-between text-xs">
              <div className="flex items-center gap-2">
                <span
                  aria-label={`${s.name} ${statusWord(s)}`}
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: statusColor(s), boxShadow: `0 0 6px 0 ${statusColor(s)}` }}
                />
                <span className="text-zinc-300">{s.name}</span>
              </div>
              <span className="font-mono tabular-nums text-zinc-500">
                <span className="text-accent">{s.encoder.toFixed(2)}</span>
                {a ? ` → ${a.target.toFixed(2)}` : ""}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
