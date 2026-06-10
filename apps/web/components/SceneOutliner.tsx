"use client";

import type { ReactNode } from "react";
import { Bot, Box, Video, Grid3x3, Sun, Plus, Target, X } from "lucide-react";

export interface SceneOutlinerProps {
  robotLabel: string;
  objects: { id: string; position: [number, number, number] }[];
  target: [number, number, number] | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddCube: () => void;
  onAddTarget: () => void;
  onRemoveObject: (id: string) => void;
  onRemoveTarget: () => void;
}

function Row({
  icon,
  label,
  active,
  onClick,
  onRemove,
}: {
  icon: ReactNode;
  label: string;
  active?: boolean;
  onClick?: () => void;
  onRemove?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`group flex items-center gap-2 rounded px-2 py-1.5 ${onClick ? "cursor-pointer" : ""} ${
        active ? "bg-cyan-500/15 text-cyan-200" : "text-zinc-300 hover:bg-white/5"
      }`}
    >
      <span className="grid w-4 place-items-center text-zinc-500">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="hidden text-zinc-500 hover:text-red-400 group-hover:block"
        >
          <X size={12} />
        </button>
      )}
    </div>
  );
}

export function SceneOutliner({
  robotLabel,
  objects,
  target,
  selectedId,
  onSelect,
  onAddCube,
  onAddTarget,
  onRemoveObject,
  onRemoveTarget,
}: SceneOutlinerProps) {
  return (
    <aside className="flex w-56 flex-col border-r border-white/10 bg-[#14171e] text-xs">
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
        <span className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Scene</span>
        <div className="flex gap-1">
          <button
            title="添加正方体"
            onClick={onAddCube}
            className="grid h-5 w-5 place-items-center rounded text-cyan-300/80 hover:bg-white/10 hover:text-cyan-200"
          >
            <Plus size={13} />
          </button>
          <button
            title="添加目标 (target)"
            onClick={onAddTarget}
            className="grid h-5 w-5 place-items-center rounded text-amber-300/70 hover:bg-white/10 hover:text-amber-300"
          >
            <Target size={13} />
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 overflow-y-auto p-2">
        <Row icon={<Bot size={14} />} label={robotLabel || "robot"} />
        {objects.map((o, i) => (
          <Row
            key={o.id}
            icon={<Box size={14} />}
            label={`Cube ${i + 1}`}
            active={selectedId === o.id}
            onClick={() => onSelect(o.id)}
            onRemove={() => onRemoveObject(o.id)}
          />
        ))}
        {target && (
          <Row
            icon={<Target size={14} />}
            label="Target"
            active={selectedId === "target"}
            onClick={() => onSelect("target")}
            onRemove={onRemoveTarget}
          />
        )}
        <Row icon={<Video size={14} />} label="Cameras" />
        <Row icon={<Grid3x3 size={14} />} label="Grid" />
        <Row icon={<Sun size={14} />} label="Lights" />
      </div>
    </aside>
  );
}
