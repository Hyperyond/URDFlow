"use client";

import { useState, type ReactNode } from "react";
import { Bot, Box, Video, Grid3x3, Sun, Plus, Target, X, Sparkles, Loader2 } from "lucide-react";

export interface SceneOutlinerProps {
  robotLabel: string;
  objects: { id: string; position: [number, number, number]; color?: string }[];
  targets: { id: string; position: [number, number, number] }[];
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onAddCube: () => void;
  onAddTarget: () => void;
  onRemoveObject: (id: string) => void;
  onRemoveTarget: (id: string) => void;
  onPromptScene: (prompt: string) => Promise<void>;
  chains: { name: string; joints: string[]; gripperJoints: string[] }[];
  activeChainIdx: number;
  onPickChain: (idx: number) => void;
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
  targets,
  selectedId,
  onSelect,
  onAddCube,
  onAddTarget,
  onRemoveObject,
  onRemoveTarget,
  onPromptScene,
  chains,
  activeChainIdx,
  onPickChain,
}: SceneOutlinerProps) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const p = prompt.trim();
    if (!p || busy) return;
    setBusy(true);
    try {
      await onPromptScene(p);
      setPrompt("");
    } finally {
      setBusy(false);
    }
  };

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
      {/* prompt-to-scene: describe the layout, Claude (or the local parser) builds it */}
      <div className="border-b border-white/10 p-2">
        <div className="flex items-center gap-1 rounded border border-white/10 bg-black/20 px-1.5 py-1 focus-within:border-cyan-400/40">
          <Sparkles size={12} className="shrink-0 text-cyan-300/70" />
          <input
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void submit();
            }}
            placeholder="描述场景,如:三个红方块分拣"
            title="用提示词生成场景"
            disabled={busy}
            className="w-full bg-transparent text-[11px] text-zinc-200 placeholder-zinc-600 outline-none"
          />
          <button
            title="生成场景"
            onClick={() => void submit()}
            disabled={busy || !prompt.trim()}
            className="grid h-5 w-5 shrink-0 place-items-center rounded text-cyan-300/80 hover:bg-white/10 disabled:opacity-40"
          >
            {busy ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-0.5 overflow-y-auto p-2">
        <Row icon={<Bot size={14} />} label={robotLabel || "robot"} />
        {/* multi-chain robots (humanoids): pick which limb the program drives */}
        {chains.length > 1 && (
          <select
            title="选择活动运动链"
            value={activeChainIdx}
            onChange={(e) => onPickChain(Number(e.target.value))}
            className="mx-1 mb-1 rounded border border-white/10 bg-black/30 px-1.5 py-1 text-[11px] text-zinc-200 outline-none focus:border-cyan-400/40"
          >
            {chains.map((c, i) => (
              <option key={i} value={i}>
                {c.name} · {c.joints.length} 关节{c.gripperJoints.length ? " · 带夹爪" : ""}
              </option>
            ))}
          </select>
        )}
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
        {targets.map((t, i) => (
          <Row
            key={t.id}
            icon={<Target size={14} />}
            label={`Target ${i + 1}`}
            active={selectedId === t.id}
            onClick={() => onSelect(t.id)}
            onRemove={() => onRemoveTarget(t.id)}
          />
        ))}
        <Row icon={<Video size={14} />} label="Cameras" />
        <Row icon={<Grid3x3 size={14} />} label="Grid" />
        <Row icon={<Sun size={14} />} label="Lights" />
      </div>
    </aside>
  );
}
