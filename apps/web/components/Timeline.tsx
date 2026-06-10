"use client";

import type { ReactNode } from "react";
import type { Keyframe } from "@urdflow/urdf-web";

export interface TimelineProps {
  keyframes: Keyframe[];
  playhead: number;
  duration: number;
  isPlaying: boolean;
  isRecording: boolean;
  loop: boolean;
  onRecord: () => void;
  onPlay: () => void;
  onPause: () => void;
  onStop: () => void;
  onToggleLoop: () => void;
  onExport: () => void;
}

function TBtn({
  title,
  active,
  onClick,
  children,
}: {
  title: string;
  active?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`grid h-7 w-7 place-items-center rounded text-sm transition-colors ${
        active ? "bg-white/10 text-zinc-100" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
      }`}
    >
      {children}
    </button>
  );
}

function GripperTrack({ keyframes, duration }: { keyframes: Keyframe[]; duration: number }) {
  const pts = keyframes
    .map((k) => `${(k.t / duration) * 100},${28 - k.gripper * 22}`)
    .join(" ");
  return (
    <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 30">
      <polyline points={pts} fill="none" stroke="#22d3ee" strokeWidth="1" vectorEffect="non-scaling-stroke" />
      {keyframes.map((k, i) => (
        <circle key={i} cx={(k.t / duration) * 100} cy={28 - k.gripper * 22} r="0.8" fill="#22d3ee" />
      ))}
    </svg>
  );
}

export function Timeline({
  keyframes,
  playhead,
  duration,
  isPlaying,
  isRecording,
  loop,
  onRecord,
  onPlay,
  onPause,
  onStop,
  onToggleLoop,
  onExport,
}: TimelineProps) {
  const pct = duration > 0 ? (playhead / duration) * 100 : 0;
  return (
    <div className="flex h-40 flex-col border-t border-white/[0.06] bg-[#0c0e12]">
      {/* transport bar */}
      <div className="flex items-center gap-1 border-b border-white/[0.06] px-3 py-1.5">
        <TBtn title="录制" active={isRecording} onClick={onRecord}>
          <span className={isRecording ? "text-red-400" : "text-zinc-400"}>●</span>
        </TBtn>
        <TBtn title={isPlaying ? "暂停" : "播放"} onClick={isPlaying ? onPause : onPlay}>
          {isPlaying ? "⏸" : "▶"}
        </TBtn>
        <TBtn title="停止" onClick={onStop}>
          ⏹
        </TBtn>
        <TBtn title="循环" active={loop} onClick={onToggleLoop}>
          🔁
        </TBtn>
        <span className="ml-2 font-mono text-[11px] text-zinc-500">
          {playhead.toFixed(2)} / {duration.toFixed(2)}s
        </span>
        <button
          onClick={onExport}
          className="ml-auto rounded px-2 py-1 text-[11px] text-zinc-300 transition-colors hover:bg-white/5"
        >
          导出 episode.zip
        </button>
      </div>

      {/* track / curves */}
      <div className="relative flex-1 overflow-hidden px-3 py-2">
        <div className="mb-1 text-[10px] uppercase tracking-wider text-zinc-600">gripper</div>
        {keyframes.length < 2 ? (
          <div className="grid h-full place-items-center text-[11px] text-zinc-600">
            ▶ 播放即自动规划抓取并运行（无需人工生成）
          </div>
        ) : (
          <div className="h-[calc(100%-1rem)]">
            <GripperTrack keyframes={keyframes} duration={duration} />
          </div>
        )}
        {duration > 0 && (
          <div className="pointer-events-none absolute inset-y-0 w-px bg-accent" style={{ left: `calc(0.75rem + ${pct}% * 0.92)` }} />
        )}
      </div>
    </div>
  );
}
