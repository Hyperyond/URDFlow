"use client";

import type { ReactNode } from "react";

export interface SceneNode {
  id: string;
  label: string;
  icon?: ReactNode;
}

export function SceneOutliner({ nodes }: { nodes: SceneNode[] }) {
  return (
    <aside className="flex w-56 flex-col border-r border-white/10 bg-[#14171e] text-xs">
      <div className="border-b border-white/10 px-3 py-2 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
        Scene
      </div>
      <div className="flex flex-col gap-0.5 overflow-y-auto p-2">
        {nodes.length === 0 && <p className="px-2 py-1 text-zinc-500">空场景</p>}
        {nodes.map((n) => (
          <div
            key={n.id}
            className="flex items-center gap-2 rounded px-2 py-1.5 text-zinc-300 hover:bg-white/5"
          >
            <span className="grid w-4 place-items-center text-zinc-500">{n.icon}</span>
            {n.label}
          </div>
        ))}
      </div>
    </aside>
  );
}
