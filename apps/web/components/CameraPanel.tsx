"use client";

import { Video } from "lucide-react";
import type { RefObject } from "react";

export interface CameraPanelProps {
  frontRef: RefObject<HTMLCanvasElement | null>;
  topRef: RefObject<HTMLCanvasElement | null>;
}

export function CameraPanel({ frontRef, topRef }: CameraPanelProps) {
  const cams: { k: string; ref: RefObject<HTMLCanvasElement | null> }[] = [
    { k: "observation.front", ref: frontRef },
    { k: "observation.top", ref: topRef },
  ];
  return (
    <aside className="flex w-52 flex-col gap-2 border-l border-white/10 bg-[#14171e] p-2 text-xs">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
        <Video size={12} /> Cameras
      </div>
      {cams.map(({ k, ref }) => (
        <div key={k} className="overflow-hidden rounded border border-white/10 bg-black/60">
          <canvas ref={ref} width={256} height={256} className="block aspect-square w-full" />
          <div className="border-t border-white/10 px-2 py-1 font-mono text-[10px] text-zinc-400">{k}</div>
        </div>
      ))}
    </aside>
  );
}
