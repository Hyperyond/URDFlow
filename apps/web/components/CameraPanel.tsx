"use client";

import { Video } from "lucide-react";

export function CameraPanel() {
  return (
    <aside className="flex w-52 flex-col gap-2 border-l border-white/10 bg-[#14171e] p-2 text-xs">
      <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Cameras</div>
      {["front", "wrist"].map((c) => (
        <div key={c} className="overflow-hidden rounded border border-white/10 bg-black/50">
          <div className="grid aspect-video place-items-center text-zinc-600">
            <Video size={20} />
          </div>
          <div className="border-t border-white/10 px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-400">
            {c}
          </div>
        </div>
      ))}
      <p className="text-[10px] leading-relaxed text-zinc-500">
        录制时这两路将写入 episode.zip（下一步接入真画面）。
      </p>
    </aside>
  );
}
