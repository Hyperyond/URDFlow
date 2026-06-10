"use client";

export function LoadingOverlay({ progress }: { progress: number }) {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-[#0a0b0d]/60 backdrop-blur-sm">
      <div className="flex w-56 flex-col gap-2">
        <div className="font-mono text-[11px] uppercase tracking-wider text-zinc-400">
          Loading · {Math.round(progress * 100)}%
        </div>
        <div className="h-px w-full bg-white/10">
          <div
            className="h-px bg-accent shadow-[0_0_8px_0_#22d3ee] transition-all"
            style={{ width: `${Math.max(4, progress * 100)}%` }}
          />
        </div>
      </div>
    </div>
  );
}
