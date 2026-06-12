import { stageById } from "../lib/pipeline";

/** Consistent header for a pipeline-stage page. */
export function StageHeader({ id }: { id: string }) {
  const s = stageById(id);
  if (!s) return null;
  return (
    <div className="rise">
      <div className="flex items-center gap-3">
        <span className="font-mono text-sm tabular-nums text-accent/70">{s.index}</span>
        <span className="eyebrow">{s.en}</span>
        {s.status === "wip" && (
          <span className="rounded-full border border-line-strong px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
            前端预览 · 后端规划中
          </span>
        )}
      </div>
      <h1 className="mt-3 font-display text-4xl font-bold tracking-tight text-zinc-50">{s.name}</h1>
      <p className="mt-3 max-w-2xl text-base leading-relaxed text-zinc-400">{s.blurb}</p>
      <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-500">
        <span className="font-mono text-[10px] uppercase tracking-wider text-accent/60">edge · </span>
        {s.edge}
      </p>
    </div>
  );
}
