import { StageHeader } from "../../../components/StageHeader";

const SKILLS = [
  { t: 0.0, name: "approach", color: "#22d3ee" },
  { t: 0.28, name: "grasp", color: "#34d399" },
  { t: 0.52, name: "lift", color: "#fbbf24" },
  { t: 0.74, name: "place", color: "#a78bfa" },
];

export default function AnnotatePage() {
  return (
    <div className="mx-auto max-w-5xl px-10 py-10">
      <StageHeader id="annotate" />

      <div className="rise mt-10 rounded-xl border border-line bg-panel p-6" style={{ animationDelay: "80ms" }}>
        <div className="flex items-center justify-between">
          <div className="eyebrow">技能分段 · climb_00.npz</div>
          <span className="font-mono text-xs text-zinc-500">20.1s · 604 帧</span>
        </div>

        {/* skill timeline */}
        <div className="mt-5">
          <div className="relative h-12 overflow-hidden rounded-lg border border-line bg-raised">
            {SKILLS.map((s, i) => {
              const next = SKILLS[i + 1]?.t ?? 1;
              return (
                <div
                  key={s.name}
                  className="absolute top-0 flex h-full items-center justify-center border-r border-base/50 font-mono text-[11px]"
                  style={{
                    left: `${s.t * 100}%`,
                    width: `${(next - s.t) * 100}%`,
                    background: `${s.color}1a`,
                    color: s.color,
                  }}
                >
                  {s.name}
                </div>
              );
            })}
          </div>
          {/* ruler */}
          <div className="mt-1 flex justify-between font-mono text-[10px] text-zinc-600">
            {[0, 5, 10, 15, 20].map((t) => (
              <span key={t}>{t}s</span>
            ))}
          </div>
        </div>

        {/* task language */}
        <div className="mt-6 grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <div className="eyebrow">任务语言</div>
            <div className="mt-2 rounded-lg border border-line bg-raised p-4 text-sm leading-relaxed text-zinc-300">
              “爬上前方的箱子,保持双手支撑直到身体完全上去。”
            </div>
          </div>
          <div>
            <div className="eyebrow">3D 同屏对齐</div>
            <div className="mt-2 grid h-[88px] place-items-center rounded-lg border border-line bg-raised">
              <span className="font-mono text-xs text-zinc-600">标注挂在 3D 轨迹上,非视频拉条</span>
            </div>
          </div>
        </div>
      </div>

      <p className="rise mt-8 font-mono text-[11px] text-zinc-600" style={{ animationDelay: "160ms" }}>
        不做通用图像 / 点云标注(Encord 的地盘)—— 只做轨迹语义:技能分段、任务描述、关键帧。
      </p>
    </div>
  );
}
