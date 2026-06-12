import { StageHeader } from "../../../components/StageHeader";

export default function TrainPage() {
  return (
    <div className="mx-auto max-w-5xl px-10 py-10">
      <StageHeader id="train" />

      <div className="rise mt-10 grid grid-cols-1 gap-5 lg:grid-cols-2" style={{ animationDelay: "80ms" }}>
        {/* export targets */}
        <div className="hud rounded-xl border border-line bg-panel p-6">
          <div className="eyebrow">Export · training frameworks</div>
          <div className="mt-4 space-y-3">
            {[
              { t: "LeRobot v3", d: "parquet + video shards", on: true },
              { t: "holosoma", d: "whole-body tracking config", on: true },
              { t: "Isaac Lab", d: "USD / motion reference", on: false },
            ].map((x) => (
              <div key={x.t} className="flex items-center justify-between rounded-lg border border-line bg-raised px-4 py-3">
                <div>
                  <div className="font-medium text-zinc-200">{x.t}</div>
                  <div className="font-mono text-[11px] text-zinc-500">{x.d}</div>
                </div>
                <span
                  className={`font-mono text-[10px] uppercase tracking-wider ${x.on ? "text-signal-ok" : "text-zinc-600"}`}
                >
                  {x.on ? "ready" : "planned"}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* run monitor mock */}
        <div className="hud rounded-xl border border-line bg-panel p-6">
          <div className="flex items-center justify-between">
            <div className="eyebrow">Training monitor</div>
            <span className="flex items-center gap-1.5">
              <span className="pulse h-1.5 w-1.5 rounded-full bg-signal-ok" />
              <span className="font-mono text-[10px] uppercase text-signal-ok">running</span>
            </span>
          </div>
          {/* sparkline */}
          <svg viewBox="0 0 240 80" className="mt-4 h-24 w-full">
            <polyline
              fill="none"
              stroke="#22d3ee"
              strokeWidth="1.5"
              points="0,72 30,60 60,52 90,40 120,34 150,24 180,20 210,15 240,12"
            />
            <polyline
              fill="url(#g)"
              stroke="none"
              points="0,72 30,60 60,52 90,40 120,34 150,24 180,20 210,15 240,12 240,80 0,80"
              opacity="0.15"
            />
            <defs>
              <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#22d3ee" />
                <stop offset="1" stopColor="#22d3ee" stopOpacity="0" />
              </linearGradient>
            </defs>
          </svg>
          <div className="mt-3 grid grid-cols-3 gap-3 font-mono text-xs">
            <div>
              <div className="text-zinc-500">step</div>
              <div className="tabular-nums text-zinc-200">48,000</div>
            </div>
            <div>
              <div className="text-zinc-500">reward</div>
              <div className="tabular-nums text-signal-ok">+0.92</div>
            </div>
            <div>
              <div className="text-zinc-500">checkpoint</div>
              <div className="tabular-nums text-accent">ckpt-48k.onnx</div>
            </div>
          </div>
          <button className="mt-5 w-full rounded-lg border border-accent/40 bg-accent/10 py-2.5 font-medium text-accent transition-colors hover:bg-accent/20">
            Watch this checkpoint run in the browser
          </button>
        </div>
      </div>

      <p className="rise mt-8 font-mono text-[11px] text-zinc-600" style={{ animationDelay: "160ms" }}>
        We don&apos;t rebuild the trainer (holosoma / Isaac Lab are open source) — we&apos;re the best frontend for
        them: one-click export, launch, and browser policy verification.
      </p>
    </div>
  );
}
