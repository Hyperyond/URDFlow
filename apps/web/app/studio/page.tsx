"use client";

import Link from "next/link";
import { STAGES } from "../../lib/pipeline";

export default function StudioHome() {
  return (
    <div className="mx-auto max-w-6xl px-10 py-10">
      {/* ---- header strip ---- */}
      <div className="rise flex items-center justify-between" style={{ animationDelay: "0ms" }}>
        <div className="flex items-center gap-3">
          <span className="pulse h-2 w-2 rounded-full bg-signal-ok" />
          <span className="eyebrow">Mission Control · 机器人数据流水线</span>
        </div>
        <div className="font-mono text-[11px] text-zinc-500">
          v0.3 · {STAGES.filter((s) => s.status === "live").length}/{STAGES.length} 阶段在线
        </div>
      </div>

      {/* ---- hero ---- */}
      <div className="rise mt-10 max-w-3xl" style={{ animationDelay: "60ms" }}>
        <h1 className="font-display text-[3.25rem] font-bold leading-[1.05] tracking-tight text-zinc-50">
          一个工作台,
          <br />
          从<span className="text-accent">采集</span>到<span className="text-accent">训练</span>。
        </h1>
        <p className="mt-6 text-lg leading-relaxed text-zinc-400">
          机器人学习数据的全流程驾驶舱。浏览器里跑,零安装,链接即分享 ——
          其中<span className="text-zinc-200">质检</span>是别人没有的杀手锏:懂机器人语义,自动判定数据能不能拿去训练。
        </p>
        <div className="mt-8 flex gap-3">
          <Link
            href="/dataset"
            className="group flex items-center gap-2 rounded-lg bg-accent px-5 py-2.5 font-medium text-[#06181c] transition-transform hover:scale-[1.02]"
          >
            运行质检
            <span className="transition-transform group-hover:translate-x-0.5">→</span>
          </Link>
          <Link
            href="/player"
            className="rounded-lg border border-line-strong px-5 py-2.5 font-medium text-zinc-200 transition-colors hover:bg-white/5"
          >
            轨迹播放器
          </Link>
        </div>
      </div>

      {/* ---- pipeline flow ---- */}
      <div className="rise mt-16" style={{ animationDelay: "120ms" }}>
        <div className="mb-5 flex items-center gap-4">
          <span className="eyebrow">流水线</span>
          <span className="h-px flex-1 bg-line" />
        </div>

        <div className="grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-2 lg:grid-cols-3">
          {STAGES.map((s, i) => (
            <Link
              key={s.id}
              href={s.href}
              className="hud group relative flex flex-col bg-panel p-6 transition-colors hover:bg-raised"
              style={{ animationDelay: `${160 + i * 50}ms` }}
            >
              <div className="flex items-start justify-between">
                <span className="font-mono text-2xl font-medium tabular-nums text-zinc-700 transition-colors group-hover:text-accent/70">
                  {s.index}
                </span>
                {s.status === "live" ? (
                  <span className="flex items-center gap-1.5 rounded-full border border-signal-ok/30 bg-signal-ok/10 px-2 py-0.5">
                    <span className="h-1.5 w-1.5 rounded-full bg-signal-ok" />
                    <span className="font-mono text-[9px] uppercase tracking-wider text-signal-ok">已上线</span>
                  </span>
                ) : (
                  <span className="rounded-full border border-line-strong px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
                    规划中
                  </span>
                )}
              </div>

              <div className="mt-4 flex items-baseline gap-2">
                <h3 className="font-display text-xl font-semibold text-zinc-100">{s.name}</h3>
                <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-600">{s.en}</span>
              </div>
              <p className="mt-2 text-sm leading-relaxed text-zinc-400">{s.blurb}</p>

              <div className="mt-4 border-t border-line pt-3">
                <p className="text-xs leading-relaxed text-zinc-500">
                  <span className="font-mono text-[10px] uppercase tracking-wider text-accent/60">edge · </span>
                  {s.edge}
                </p>
              </div>

              <span className="mt-4 inline-flex items-center gap-1 font-mono text-[11px] uppercase tracking-wider text-zinc-500 transition-colors group-hover:text-accent">
                进入 <span className="transition-transform group-hover:translate-x-0.5">→</span>
              </span>
            </Link>
          ))}
        </div>
      </div>

      {/* ---- positioning footer ---- */}
      <div
        className="rise mt-10 grid grid-cols-1 gap-px overflow-hidden rounded-xl border border-line bg-line md:grid-cols-3"
        style={{ animationDelay: "320ms" }}
      >
        {[
          { k: "他们 → 我们", v: "管理后台 → 开源驾驶舱", d: "重、要私有化部署 → 浏览器零安装" },
          { k: "差异化", v: "看见数据 → 判定数据", d: "面板看 1 条 → 引擎筛 1 万条" },
          { k: "护城河", v: "机器人语义质检", d: "懂 URDF + 物理回放,别人抄起来贵" },
        ].map((c) => (
          <div key={c.k} className="bg-panel p-6">
            <div className="eyebrow">{c.k}</div>
            <div className="mt-2 font-display text-base font-semibold text-zinc-100">{c.v}</div>
            <div className="mt-1 text-xs leading-relaxed text-zinc-500">{c.d}</div>
          </div>
        ))}
      </div>

      <div className="mt-8 text-center font-mono text-[11px] text-zinc-600">
        URDFlow · 开源机器人数据工作台 · 不做日志可视化 / 感知标注 / 自产数据
      </div>
    </div>
  );
}
