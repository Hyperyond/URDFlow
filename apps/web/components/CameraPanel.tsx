"use client";

export function CameraPanel() {
  return (
    <aside className="flex w-52 flex-col gap-2 border-l border-white/[0.06] bg-white/[0.015] p-2 text-xs">
      <div className="text-[11px] uppercase tracking-wider text-zinc-500">Cameras</div>
      {["front", "wrist"].map((c) => (
        <div key={c} className="overflow-hidden rounded border border-white/[0.06] bg-black/40">
          <div className="grid aspect-video place-items-center text-zinc-600">{c} cam</div>
          <div className="border-t border-white/[0.06] px-2 py-1 text-[10px] uppercase tracking-wider text-zinc-500">
            {c}
          </div>
        </div>
      ))}
      <p className="text-[10px] leading-relaxed text-zinc-600">
        录制时这两路将写入 episode.zip（下一步接入真画面）。
      </p>
    </aside>
  );
}
