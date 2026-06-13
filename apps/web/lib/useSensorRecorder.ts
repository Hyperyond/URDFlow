"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SensorSession, exportDatasetZip } from "./sensorCapture";

export interface SensorRecorder {
  /** Pass into CaptureRig; non-null while an episode is recording. */
  session: SensorSession | null;
  capturing: boolean;
  /** Frames buffered so far (live while capturing, frozen after stop). */
  frameCount: number;
  canExport: boolean;
  exporting: boolean;
  toggle: () => void;
  exportZip: () => void;
}

/** Owns the sensor-episode lifecycle: start/stop buffering and dataset download. */
export function useSensorRecorder(hz = 10): SensorRecorder {
  const [session, setSession] = useState<SensorSession | null>(null);
  const [frameCount, setFrameCount] = useState(0);
  const [exporting, setExporting] = useState(false);
  const lastEpisode = useRef<SensorSession | null>(null);

  // session.frames grows outside React — poll a cheap counter while capturing
  useEffect(() => {
    if (!session) return;
    const id = setInterval(() => setFrameCount(session.frames.length), 250);
    return () => clearInterval(id);
  }, [session]);

  const toggle = useCallback(() => {
    setSession((s) => {
      if (s) {
        lastEpisode.current = s;
        setFrameCount(s.frames.length);
        return null;
      }
      lastEpisode.current = null;
      setFrameCount(0);
      return new SensorSession(hz);
    });
  }, [hz]);

  const exportZip = useCallback(() => {
    const ep = lastEpisode.current;
    if (!ep || ep.frames.length === 0 || exporting) return;
    setExporting(true);
    void exportDatasetZip(ep)
      .then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = "sensor_dataset.zip";
        a.click();
        URL.revokeObjectURL(url);
      })
      .finally(() => setExporting(false));
  }, [exporting]);

  return {
    session,
    capturing: session !== null,
    frameCount,
    canExport: (lastEpisode.current?.frames.length ?? 0) > 0,
    exporting,
    toggle,
    exportZip,
  };
}
