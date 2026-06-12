"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { STAGES } from "../lib/pipeline";

/**
 * The persistent rail of the workbench: wordmark, the six pipeline stages as a
 * numbered vertical index with live/wip status, and a footer. Active stage is
 * matched by href prefix so /dataset and /player light up too.
 */
export function StudioSidebar() {
  const path = usePathname();
  const isActive = (href: string) => path === href || (href !== "/studio" && path.startsWith(href));

  return (
    <aside className="relative z-10 flex h-screen w-[248px] shrink-0 flex-col border-r border-line bg-[#0a0c10]/80 backdrop-blur">
      {/* wordmark */}
      <Link href="/studio" className="group flex items-center gap-3 px-6 py-6">
        <span className="relative grid h-8 w-8 place-items-center">
          <svg viewBox="0 0 32 32" className="h-8 w-8">
            <rect x="3" y="3" width="26" height="26" rx="5" fill="none" stroke="#22d3ee" strokeWidth="1.5" opacity="0.6" />
            <circle cx="16" cy="16" r="3.5" fill="#22d3ee" />
            <path d="M16 6 v6 M16 20 v6 M6 16 h6 M20 16 h6" stroke="#22d3ee" strokeWidth="1.5" opacity="0.85" />
          </svg>
          <span className="pulse absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-signal-ok" />
        </span>
        <div className="leading-none">
          <div className="font-display text-[15px] font-bold tracking-tight text-zinc-100">URDFLOW</div>
          <div className="font-mono text-[9px] uppercase tracking-[0.2em] text-zinc-500">data workbench</div>
        </div>
      </Link>

      <div className="px-6 pb-2">
        <div className="eyebrow">Pipeline</div>
      </div>

      <nav className="flex-1 px-3">
        {STAGES.map((s) => {
          const active = isActive(s.href);
          return (
            <Link
              key={s.id}
              href={s.href}
              className={`group relative flex items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                active ? "bg-accent/10 text-zinc-100" : "text-zinc-400 hover:bg-white/5 hover:text-zinc-200"
              }`}
            >
              {active && <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />}
              <span
                className={`font-mono text-[11px] tabular-nums ${active ? "text-accent" : "text-zinc-600 group-hover:text-zinc-500"}`}
              >
                {s.index}
              </span>
              <span className="flex-1 font-medium">{s.name}</span>
              {s.status === "live" ? (
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 rounded-full bg-signal-ok" />
                  <span className="font-mono text-[9px] uppercase tracking-wider text-signal-ok/80">live</span>
                </span>
              ) : (
                <span className="font-mono text-[9px] uppercase tracking-wider text-zinc-600">wip</span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-t border-line px-6 py-4">
        <Link
          href="/"
          className="font-mono text-[11px] uppercase tracking-wider text-zinc-500 transition-colors hover:text-zinc-300"
        >
          ← 3D 编辑器
        </Link>
        <div className="mt-2 font-mono text-[10px] text-zinc-600">开源 · 零安装 · 浏览器原生</div>
      </div>
    </aside>
  );
}
