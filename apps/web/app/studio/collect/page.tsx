import { StageHeader } from "../../../components/StageHeader";

export default function CollectPage() {
  return (
    <div className="mx-auto max-w-5xl px-10 py-10">
      <StageHeader id="collect" />

      <div className="rise mt-10 grid grid-cols-1 gap-5 lg:grid-cols-2" style={{ animationDelay: "80ms" }}>
        {/* teleop device card */}
        <div className="hud rounded-xl border border-line bg-panel p-6">
          <div className="eyebrow">真机直连</div>
          <div className="mt-4 flex items-center gap-4">
            <div className="grid h-14 w-14 place-items-center rounded-lg border border-line-strong bg-raised">
              <svg viewBox="0 0 24 24" className="h-7 w-7 text-accent" fill="none" stroke="currentColor" strokeWidth="1.5">
                <rect x="3" y="8" width="18" height="10" rx="2" />
                <path d="M7 8V5h10v3M9 18v2M15 18v2" />
              </svg>
            </div>
            <div>
              <div className="font-display text-lg font-semibold text-zinc-100">SO-101 · WebSerial</div>
              <div className="font-mono text-xs text-zinc-500">浏览器直连,无需驱动 / SDK</div>
            </div>
          </div>
          <div className="mt-5 space-y-2">
            {[
              { label: "端口", val: "/dev/tty.usbmodem · 1 000 000 baud" },
              { label: "标定", val: "6 关节 · 自动零位" },
              { label: "采样", val: "30 Hz · 双相机观测流" },
            ].map((r) => (
              <div key={r.label} className="flex items-center justify-between border-b border-line py-2 text-sm">
                <span className="text-zinc-500">{r.label}</span>
                <span className="font-mono text-xs text-zinc-300">{r.val}</span>
              </div>
            ))}
          </div>
          <button className="mt-5 w-full rounded-lg border border-accent/40 bg-accent/10 py-2.5 font-medium text-accent transition-colors hover:bg-accent/20">
            连接设备(@lerobot/web)
          </button>
        </div>

        {/* import card */}
        <div className="hud rounded-xl border border-line bg-panel p-6">
          <div className="eyebrow">或:导入已有数据</div>
          <div className="mt-4 grid grid-cols-2 gap-3">
            {["LeRobot v3", "OmniRetarget", "HDF5 / RLDS", "MCAP(只读)"].map((f) => (
              <div
                key={f}
                className="rounded-lg border border-line bg-raised px-4 py-5 text-center font-mono text-xs text-zinc-400"
              >
                {f}
              </div>
            ))}
          </div>
          <div className="mt-4 rounded-lg border border-dashed border-line-strong py-10 text-center text-sm text-zinc-500">
            拖入数据集文件夹 / .zip
          </div>
        </div>
      </div>

      <p className="rise mt-8 font-mono text-[11px] text-zinc-600" style={{ animationDelay: "160ms" }}>
        采集不自建硬件 / 遥操作大军 —— 直连 HF 官方 @lerobot/web,采完即进质检流水线。
      </p>
    </div>
  );
}
