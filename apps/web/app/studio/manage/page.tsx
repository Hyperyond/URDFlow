import { StageHeader } from "../../../components/StageHeader";

const COMMITS = [
  { hash: "2283848", msg: "Add 405 carry trajectories", gate: "pass", score: 94, n: 405 },
  { hash: "62b6847", msg: "Re-label climb skill segments", gate: "pass", score: 96, n: 120 },
  { hash: "9473782", msg: "Import LAFAN retarget batch", gate: "fail", score: 71, n: 880 },
  { hash: "2a01c92", msg: "Initial OMOMO dataset", gate: "pass", score: 92, n: 1240 },
];

export default function ManagePage() {
  return (
    <div className="mx-auto max-w-5xl px-10 py-10">
      <StageHeader id="manage" />

      <div className="rise mt-10 grid grid-cols-1 gap-5 lg:grid-cols-3" style={{ animationDelay: "80ms" }}>
        {[
          { k: "Dataset", v: "g1-loco-manip", d: "2,645 episodes · 18.4 GB" },
          { k: "Quality gate", v: "≥ 90", d: "CI-style · auto-rejects below threshold" },
          { k: "Collaborators", v: "4", d: "write / review / read-only" },
        ].map((c) => (
          <div key={c.k} className="hud rounded-xl border border-line bg-panel p-5">
            <div className="eyebrow">{c.k}</div>
            <div className="mt-2 font-display text-lg font-semibold text-zinc-100">{c.v}</div>
            <div className="mt-1 font-mono text-xs text-zinc-500">{c.d}</div>
          </div>
        ))}
      </div>

      {/* commit log with quality gate */}
      <div className="rise mt-5 overflow-hidden rounded-xl border border-line bg-panel" style={{ animationDelay: "140ms" }}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div className="eyebrow">Commit history · quality gate</div>
          <span className="font-mono text-[11px] text-zinc-500">main</span>
        </div>
        {COMMITS.map((c) => (
          <div key={c.hash} className="flex items-center gap-4 border-b border-line px-5 py-3 last:border-0">
            <span className="font-mono text-xs text-zinc-600">{c.hash}</span>
            <span className="flex-1 text-sm text-zinc-300">{c.msg}</span>
            <span className="font-mono text-[11px] text-zinc-500">+{c.n}</span>
            <span
              className={`font-mono text-xs font-bold tabular-nums ${
                c.score >= 90 ? "text-signal-ok" : c.score >= 70 ? "text-signal-warn" : "text-signal-bad"
              }`}
            >
              {c.score}
            </span>
            {c.gate === "pass" ? (
              <span className="flex items-center gap-1 rounded border border-signal-ok/30 bg-signal-ok/10 px-2 py-0.5 font-mono text-[10px] uppercase text-signal-ok">
                ✓ merged
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded border border-signal-bad/30 bg-signal-bad/10 px-2 py-0.5 font-mono text-[10px] uppercase text-signal-bad">
                ✕ blocked
              </span>
            )}
          </div>
        ))}
      </div>

      <p className="rise mt-8 font-mono text-[11px] text-zinc-600" style={{ animationDelay: "200ms" }}>
        GitHub for robot datasets — hosting, versioning, quality gates. Data that fails QC never reaches main.
      </p>
    </div>
  );
}
