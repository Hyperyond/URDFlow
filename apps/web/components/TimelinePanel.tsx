"use client";

import type { Keyframe } from "@urdflow/urdf-web";

export interface TimelinePanelProps {
  keyframes: Keyframe[];
  playhead: number;
  duration: number;
  isPlaying: boolean;
  onAddKeyframe: () => void;
  onRemoveKeyframe: (index: number) => void;
  onPlay: () => void;
  onPause: () => void;
  onExport: () => void;
}

export function TimelinePanel({
  keyframes,
  playhead,
  duration,
  isPlaying,
  onAddKeyframe,
  onRemoveKeyframe,
  onPlay,
  onPause,
  onExport,
}: TimelinePanelProps) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-[11px] uppercase tracking-wider text-zinc-500">Timeline</h2>
        <span className="font-mono text-[11px] text-zinc-500">
          {playhead.toFixed(2)} / {duration.toFixed(2)}s
        </span>
      </div>
      <div className="flex gap-2">
        <button
          onClick={onAddKeyframe}
          className="rounded bg-accent/10 px-2 py-1 text-xs text-accent transition-colors hover:bg-accent/20"
        >
          + Add keyframe
        </button>
        <button
          onClick={isPlaying ? onPause : onPlay}
          className="rounded px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-white/5"
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button
          onClick={onExport}
          className="ml-auto rounded px-2 py-1 text-xs text-zinc-300 transition-colors hover:bg-white/5"
        >
          Export LeRobot
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {keyframes.length === 0 && (
          <p className="text-xs text-zinc-600">Drag the gizmo to pose, click + to add a keyframe</p>
        )}
        {keyframes.map((k, i) => (
          <div key={i} className="flex items-center justify-between rounded bg-white/[0.03] px-2 py-1 text-xs">
            <span className="font-mono text-zinc-400">{k.t.toFixed(2)}s</span>
            <span className="font-mono text-zinc-600">grip {k.gripper.toFixed(2)}</span>
            <button
              aria-label={`remove keyframe ${i}`}
              onClick={() => onRemoveKeyframe(i)}
              className="text-zinc-600 transition-colors hover:text-red-400"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}
