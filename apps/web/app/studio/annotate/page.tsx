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
          <div className="eyebrow">Skill segmentation · climb_00.npz</div>
          <span className="font-mono text-xs text-zinc-500">20.1s · 604 frames</span>
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
            <div className="eyebrow">Task language</div>
            <div className="mt-2 rounded-lg border border-line bg-raised p-4 text-sm leading-relaxed text-zinc-300">
              “Climb onto the box ahead, keeping both hands planted until the body is fully up.”
            </div>
          </div>
          <div>
            <div className="eyebrow">Aligned to 3D</div>
            <div className="mt-2 grid h-[88px] place-items-center rounded-lg border border-line bg-raised">
              <span className="font-mono text-xs text-zinc-600">Labels ride the 3D trajectory, not a video scrubber</span>
            </div>
          </div>
        </div>
      </div>

      <p className="rise mt-8 font-mono text-[11px] text-zinc-600" style={{ animationDelay: "160ms" }}>
        Not general image / point-cloud labeling (Encord&apos;s turf) — just trajectory semantics: skill
        segmentation, task descriptions, keyframes.
      </p>
    </div>
  );
}
