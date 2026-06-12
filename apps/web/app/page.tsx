"use client";

import { useEffect, useRef, useState } from "react";
import { useRobotSource } from "../lib/useRobotSource";
import { useGraspEditor } from "../lib/useGraspEditor";
import { entriesFromFileList, entriesFromZip, entriesFromDataTransfer } from "../lib/fileInput";
import { PRESETS } from "../lib/presets";
import { buildScene, type SceneKind } from "../lib/scenes";
import { sceneFromPrompt } from "../lib/promptScene";
import { MenuBar } from "../components/MenuBar";
import { SceneOutliner } from "../components/SceneOutliner";
import { CameraPanel } from "../components/CameraPanel";
import { Timeline } from "../components/Timeline";
import { RobotViewer, type CameraPose } from "../components/RobotViewer";
import { LoadingOverlay } from "../components/LoadingOverlay";

export default function Page() {
  const r = useRobotSource();
  const ed = useGraspEditor(r.robot, r.model);
  const [uploaded, setUploaded] = useState<{ label: string }[]>([]);
  const frontCamRef = useRef<HTMLCanvasElement>(null);
  const topCamRef = useRef<HTMLCanvasElement>(null);
  // camera positions: null until CaptureRig reports its auto-fit, then user-draggable
  const [camPose, setCamPose] = useState<CameraPose>({ front: null, top: null });
  // a new robot reframes from scratch — drop any manual camera placement
  useEffect(() => {
    setCamPose({ front: null, top: null });
  }, [r.source]);

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

  return (
    <div className="grid h-screen grid-rows-[auto_1fr_auto] bg-[#0e1116]">
      <MenuBar
        robotLabel={r.source.label}
        presets={PRESETS}
        uploaded={uploaded}
        onPickPreset={(p) => r.loadPreset(p)}
        onPickScene={(kind: SceneKind) => ed.applyScene(buildScene(kind, ed.workspaceAnchor()))}
        onPickFiles={handleFileList}
        onPickZip={handleZip}
      />
      <div className="grid grid-cols-[auto_1fr_auto] overflow-hidden">
        <SceneOutliner
          robotLabel={r.source.label}
          objects={ed.objects}
          targets={ed.targets}
          selectedId={ed.selectedId}
          onSelect={ed.setSelectedId}
          onAddCube={ed.addCube}
          onAddTarget={ed.addTarget}
          onRemoveObject={ed.removeObject}
          onRemoveTarget={ed.removeTarget}
          onPromptScene={async (prompt) => {
            const { scene } = await sceneFromPrompt(prompt, ed.workspaceAnchor());
            ed.applyScene(scene);
          }}
          chains={ed.chains}
          activeChainIdx={ed.activeChainIdx}
          autoHand={ed.autoHand}
          onPickChain={ed.setActiveChain}
        />
        <main className="relative">
          <RobotViewer
            robot={r.robot}
            objects={ed.objects}
            targets={ed.targets}
            surfaceY={ed.surfaceY}
            selectedId={ed.selectedId}
            onSelect={ed.setSelectedId}
            onMoveObject={ed.moveObject}
            onMoveTarget={ed.moveTarget}
            cameraPoses={camPose}
            onMoveCamera={(which, p) => setCamPose((c) => ({ ...c, [which]: p }))}
            onAutoFrameCameras={(front, top) =>
              setCamPose((c) => ({ front: c.front ?? front, top: c.top ?? top }))
            }
            captureRefs={{ front: frontCamRef, top: topCamRef }}
          />
          {r.loading && <LoadingOverlay progress={r.progress} />}
          {r.error && (
            <div className="absolute left-3 top-3 rounded border border-red-500/30 bg-red-500/10 px-2 py-1 text-xs text-red-300">
              Load failed: {r.error.message}
            </div>
          )}
          {ed.error && (
            <div className="absolute bottom-3 left-3 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-xs text-amber-300">
              {ed.error}
            </div>
          )}
        </main>
        <CameraPanel frontRef={frontCamRef} topRef={topCamRef} />
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
