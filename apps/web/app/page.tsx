"use client";

import { useEffect, useState } from "react";
import { useRobotSource } from "../lib/useRobotSource";
import { entriesFromFileList, entriesFromZip, entriesFromDataTransfer } from "../lib/fileInput";
import { PRESETS } from "../lib/presets";
import { Header } from "../components/Header";
import { Sidebar } from "../components/Sidebar";
import { ImportPanel } from "../components/ImportPanel";
import { RobotPicker } from "../components/RobotPicker";
import { JointPanel } from "../components/JointPanel";
import { RobotViewer } from "../components/RobotViewer";
import { LoadingOverlay } from "../components/LoadingOverlay";

export default function Page() {
  const r = useRobotSource();
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

  return (
    <div className="grid h-screen grid-rows-[auto_1fr]">
      <Header robotLabel={r.source.label} />
      <div className="grid grid-cols-[auto_1fr] overflow-hidden">
        <Sidebar>
          <ImportPanel onPickFiles={handleFileList} onPickZip={handleZip} busy={r.loading} />
          <RobotPicker
            presets={PRESETS}
            uploaded={uploaded}
            activeLabel={r.source.label}
            onPick={(p) => r.loadPreset(p.url, p.name)}
          />
          <JointPanel
            model={r.model}
            values={r.values}
            onChange={r.onChange}
            onReset={r.resetJoint}
            onResetAll={r.resetAll}
          />
          {r.error && (
            <p role="alert" className="rounded border border-red-500/30 bg-red-500/10 p-2 text-xs text-red-300">
              加载失败: {r.error.message}
            </p>
          )}
        </Sidebar>
        <main className="relative">
          <RobotViewer robot={r.robot} />
          {r.loading && <LoadingOverlay progress={r.progress} />}
        </main>
      </div>
    </div>
  );
}
