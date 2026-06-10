"use client";

export interface SceneNode {
  id: string;
  label: string;
  icon?: string;
}

export function SceneOutliner({ nodes }: { nodes: SceneNode[] }) {
  return (
    <aside className="flex w-56 flex-col border-r border-white/[0.06] bg-white/[0.015] text-xs">
      <div className="border-b border-white/[0.06] px-3 py-2 text-[11px] uppercase tracking-wider text-zinc-500">
        Scene
      </div>
      <div className="flex flex-col gap-0.5 overflow-y-auto p-2">
        {nodes.length === 0 && <p className="px-2 py-1 text-zinc-600">空场景</p>}
        {nodes.map((n) => (
          <div
            key={n.id}
            className="flex items-center gap-2 rounded px-2 py-1 text-zinc-300 hover:bg-white/5"
          >
            <span className="w-4 text-center text-zinc-600">{n.icon ?? "▸"}</span>
            {n.label}
          </div>
        ))}
      </div>
    </aside>
  );
}
