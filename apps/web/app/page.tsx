"use client";

import { useEffect, useState } from "react";
import { useRobotSource } from "../lib/useRobotSource";
import { useGraspEditor } from "../lib/useGraspEditor";
import { entriesFromFileList, entriesFromZip, entriesFromDataTransfer } from "../lib/fileInput";
import { PRESETS } from "../lib/presets";
import { MenuBar } from "../components/MenuBar";
import { SceneOutliner, type SceneNode } from "../components/SceneOutliner";
import { CameraPanel } from "../components/CameraPanel";
import { Timeline } from "../components/Timeline";
import { RobotViewer } from "../components/RobotViewer";
import { LoadingOverlay } from "../components/LoadingOverlay";
import { Bot, Box, Video, Grid3x3, Sun } from "lucide-react";

export default function Page() {
  const r = useRobotSource();
  const ed = useGraspEditor(r.robot, r.model);
  const [uploaded, setUploaded] = useState<{ label: string }[]>([]);

  async function handleFileList(list: FileList) {
    const entries = await entriesFromFileList(list);
    const first = list[0] as (File & { webkitRelativePath?: string }) | undefined;
    const label = first?.webkitRelativePath ? first.webkitRelativePath.split("/")[0]! : "uploaded";
    setUploaded((u) => [...u, { label }]);
    r.loadFiles(entries, label);
  }
  async function handleZip(file: File) {
    const entries = await entriesFromZip(file);
    const label = file.name.replace(/\.zip$/i, "");
    setUploaded((u) => [...u, { label }]);
    r.loadFiles(entries, label);
  }
  useEffect(() => {
    (window as unknown as { __urdfDrop?: (i: DataTransferItemList) => void }).__urdfDrop = async (
      items: DataTransferItemList,
    ) => {
      const entries = await entriesFromDataTransfer(items);
      setUploaded((u) => [...u, { label: "dropped" }]);
      r.loadFiles(entries, "dropped");
    };
    return () => {
      delete (window as unknown as { __urdfDrop?: unknown }).__urdfDrop;
    };
  }, [r.loadFiles]);

  const sceneNodes: SceneNode[] = [
    { id: "robot", label: r.source.label || "robot", icon: <Bot size={14} /> },
    { id: "box", label: "Target box", icon: <Box size={14} /> },
    { id: "cam-front", label: "Camera · front", icon: <Video size={14} /> },
    { id: "cam-wrist", label: "Camera · wrist", icon: <Video size={14} /> },
    { id: "grid", label: "Grid", icon: <Grid3x3 size={14} /> },
    { id: "lights", label: "Lights", icon: <Sun size={14} /> },
  ];

  return (
    <div className="grid h-screen grid-rows-[auto_1fr_auto] bg-[#0e1116]">
      <MenuBar
        robotLabel={r.source.label}
        presets={PRESETS}
        uploaded={uploaded}
        onPickPreset={(p) => r.loadPreset(p.url, p.name)}
        onPickFiles={handleFileList}
        onPickZip={handleZip}
      />
      <div className="grid grid-cols-[auto_1fr_auto] overflow-hidden">
        <SceneOutliner nodes={sceneNodes} />
        <main className="relative">
          <RobotViewer robot={r.robot} boxPosition={ed.boxPosition} onBoxMove={ed.setBoxPosition} />
          {r.loading && <LoadingOverlay progress={r.progress} />}
          {r.error && (
            <div className="absolute left-3 top-3 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300">
              加载失败: {r.error.message}
            </div>
          )}
          {ed.error && (
            <div className="absolute bottom-3 left-3 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
              {ed.error}
            </div>
          )}
        </main>
        <CameraPanel />
      </div>
      <Timeline
        keyframes={ed.keyframes}
        jointTracks={ed.jointTracks}
        playhead={ed.playhead}
        duration={ed.duration}
        isPlaying={ed.isPlaying}
        isRecording={ed.isRecording}
        loop={ed.loop}
        onRecord={ed.toggleRecord}
        onPlay={ed.play}
        onPause={ed.pause}
        onStop={ed.stop}
        onToggleLoop={ed.toggleLoop}
        onExport={ed.exportEpisode}
      />
    </div>
  );
}
