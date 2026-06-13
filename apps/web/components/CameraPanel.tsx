"use client";

import { Video, Circle, Square, Download, Loader2 } from "lucide-react";
import type { RefObject } from "react";
import type { SensorRecorder } from "../lib/useSensorRecorder";

export interface CameraPanelProps {
  frontRef: RefObject<HTMLCanvasElement | null>;
  topRef: RefObject<HTMLCanvasElement | null>;
  sensors?: SensorRecorder;
}

export function CameraPanel({ frontRef, topRef, sensors }: CameraPanelProps) {
  const cams: { k: string; ref: RefObject<HTMLCanvasElement | null> }[] = [
    { k: "observation.front", ref: frontRef },
    { k: "observation.top", ref: topRef },
  ];
  return (
    <aside className="flex w-52 flex-col gap-2 border-l border-white/10 bg-[#14171e] p-2 text-xs">
      <div className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-zinc-400">
        <Video size={12} /> Cameras
      </div>
      {cams.map(({ k, ref }) => (
        <div key={k} className="overflow-hidden rounded border border-white/10 bg-black/60">
          <canvas ref={ref} width={256} height={256} className="block aspect-square w-full" />
          <div className="border-t border-white/10 px-2 py-1 font-mono text-[10px] text-zinc-400">{k}</div>
        </div>
      ))}

      {sensors && (
        <div className="mt-1 flex flex-col gap-1.5 border-t border-white/10 pt-2">
          <div className="text-[11px] font-medium uppercase tracking-wider text-zinc-400">Sensor dataset</div>
          <button
            onClick={sensors.toggle}
            className={`flex items-center gap-1.5 rounded px-2 py-1.5 text-[11px] transition-colors ${
              sensors.capturing
                ? "bg-red-500/15 text-red-300 hover:bg-red-500/25"
                : "bg-white/5 text-zinc-200 hover:bg-white/10"
            }`}
          >
            {sensors.capturing ? (
              <>
                <Square size={11} className="fill-current" /> Stop · {sensors.frameCount} frames
              </>
            ) : (
              <>
                <Circle size={11} className="fill-red-500 text-red-500" /> Capture RGB·D·Seg
              </>
            )}
          </button>
          <button
            onClick={sensors.exportZip}
            disabled={!sensors.canExport || sensors.capturing || sensors.exporting}
            className="flex items-center gap-1.5 rounded bg-white/5 px-2 py-1.5 text-[11px] text-zinc-200 transition-colors enabled:hover:bg-white/10 disabled:opacity-40"
          >
            {sensors.exporting ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
            sensor_dataset.zip{!sensors.capturing && sensors.canExport ? ` (${sensors.frameCount})` : ""}
          </button>
          <p className="text-[10px] leading-snug text-zinc-500">
            Per frame: RGB PNG, depth (u16 mm), seg mask, qpos — plus camera K + extrinsics in meta.json.
          </p>
        </div>
      )}
    </aside>
  );
}
