"use client";

import type { ReactNode } from "react";
import { Circle, Play, Pause, Square, Repeat, Download } from "lucide-react";
import type { Keyframe } from "@urdflow/urdf-web";

export interface TimelineProps {
  keyframes: Keyframe[];
  jointTracks: { name: string; values: number[] }[];
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
      className={`grid h-7 w-7 place-items-center rounded transition-colors ${
        active ? "bg-white/15 text-zinc-100" : "text-zinc-400 hover:bg-white/10 hover:text-zinc-100"
      }`}
    >
      {children}
    </button>
  );
}

const hueOf = (i: number) => (i * 47) % 360;

function Curves({ tracks }: { tracks: { name: string; values: number[] }[] }) {
  return (
    <svg className="h-full w-full" preserveAspectRatio="none" viewBox="0 0 100 30">
      {tracks.map((tr, ti) => {
        const n = tr.values.length;
        if (n < 2) return null;
        const min = Math.min(...tr.values);
        const max = Math.max(...tr.values);
        const span = max - min || 1;
        const pts = tr.values.map((v, i) => `${(i / (n - 1)) * 100},${27 - ((v - min) / span) * 22}`).join(" ");
        return (
          <polyline
            key={tr.name}
            points={pts}
            fill="none"
            stroke={`hsl(${hueOf(ti)} 80% 62%)`}
            strokeWidth="1"
            vectorEffect="non-scaling-stroke"
          />
        );
      })}
    </svg>
  );
}

export function Timeline({
  keyframes,
  jointTracks,
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
  const pct = duration > 0 ? playhead / duration : 0;
  const hasCurves = jointTracks.length > 0;
  return (
    <div className="flex h-44 flex-col border-t border-white/10 bg-[#181b22]">
      {/* transport bar */}
      <div className="flex items-center gap-1 border-b border-white/10 px-3 py-1.5">
        <TBtn title="Record" active={isRecording} onClick={onRecord}>
          <Circle size={15} className={isRecording ? "fill-red-500 text-red-500" : ""} />
        </TBtn>
        <TBtn title={isPlaying ? "Pause" : "Play"} onClick={isPlaying ? onPause : onPlay}>
          {isPlaying ? <Pause size={16} /> : <Play size={16} />}
        </TBtn>
        <TBtn title="Stop" onClick={onStop}>
          <Square size={15} />
        </TBtn>
        <TBtn title="Loop" active={loop} onClick={onToggleLoop}>
          <Repeat size={15} />
        </TBtn>
        <span className="ml-2 font-mono text-[11px] text-zinc-400">
          {playhead.toFixed(2)} / {duration.toFixed(2)}s
        </span>
        <button
          onClick={onExport}
          className="ml-auto flex items-center gap-1.5 rounded bg-white/5 px-2.5 py-1 text-[11px] text-zinc-200 transition-colors hover:bg-white/10"
        >
          <Download size={13} /> episode.zip
        </button>
      </div>

      {/* per-joint curves + playhead */}
      <div className="relative flex-1 overflow-hidden px-3 py-2">
        {hasCurves ? (
          <>
            <div className="mb-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-zinc-500">
              {jointTracks.map((tr, ti) => (
                <span key={tr.name} className="flex items-center gap-1">
                  <span
                    className="inline-block h-1.5 w-1.5 rounded-full"
                    style={{ background: `hsl(${hueOf(ti)} 80% 62%)` }}
                  />
                  {tr.name}
                </span>
              ))}
            </div>
            <div className="h-[calc(100%-1.25rem)]">
              <Curves tracks={jointTracks} />
            </div>
            {duration > 0 && (
              <div
                className="pointer-events-none absolute inset-y-0 w-px bg-accent"
                style={{ left: `calc(0.75rem + (100% - 1.5rem) * ${pct})` }}
              />
            )}
          </>
        ) : (
          <div className="grid h-full place-items-center text-[11px] text-zinc-500">
            ▶ Press play to auto-plan the grasp and run it (no manual authoring)
          </div>
        )}
      </div>
    </div>
  );
}
