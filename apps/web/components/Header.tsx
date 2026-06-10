"use client";

export function Header({ robotLabel }: { robotLabel: string }) {
  return (
    <header className="flex h-12 items-center justify-between border-b border-white/[0.06] px-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold tracking-tight text-zinc-100">URDFlow</span>
        <span className="text-[11px] uppercase tracking-wider text-zinc-600">teleop capture</span>
      </div>
      <span className="font-mono text-xs text-zinc-400">{robotLabel}</span>
    </header>
  );
}
