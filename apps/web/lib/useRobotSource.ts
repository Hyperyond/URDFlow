"use client";

import { useCallback, useEffect, useState } from "react";
import {
  loadURDFFromURL,
  loadURDFFromFiles,
  getJointModel,
  setJoint,
  type JointInfo,
  type URDFRobot,
  type URDFFileEntry,
} from "@urdflow/urdf-web";
import { PRESETS } from "./presets";

type Source =
  | { kind: "preset"; url: string; label: string }
  | { kind: "files"; entries: URDFFileEntry[]; label: string };

export function useRobotSource() {
  const [source, setSource] = useState<Source>({
    kind: "preset",
    url: PRESETS[0]!.url,
    label: PRESETS[0]!.name,
  });
  const [robot, setRobot] = useState<URDFRobot | null>(null);
  const [model, setModel] = useState<JointInfo[]>([]);
  const [values, setValues] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0); // 0..1
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let alive = true;
    setRobot(null);
    setModel([]);
    setValues({});
    setError(null);
    setLoading(true);
    setProgress(0);
    const onProgress = (loaded: number, total: number) => {
      if (alive && total > 0) setProgress(loaded / total);
    };
    const p =
      source.kind === "preset"
        ? loadURDFFromURL(source.url, { onProgress })
        : loadURDFFromFiles(source.entries, { onProgress });
    p.then((r) => {
      if (!alive) return;
      setRobot(r);
      setModel(getJointModel(r));
      setLoading(false);
      setProgress(1);
    }).catch((e) => {
      if (!alive) return;
      setError(e instanceof Error ? e : new Error(String(e)));
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [source]);

  const onChange = useCallback((name: string, value: number) => {
    setRobot((r) => {
      if (r) setJoint(r, name, value);
      return r;
    });
    setValues((v) => ({ ...v, [name]: value }));
  }, []);

  const resetJoint = useCallback((name: string) => onChange(name, 0), [onChange]);

  const resetAll = useCallback(() => {
    setRobot((r) => {
      if (r) model.forEach((j) => setJoint(r, j.name, 0));
      return r;
    });
    setValues({});
  }, [model]);

  const loadPreset = useCallback(
    (url: string, label: string) => setSource({ kind: "preset", url, label }),
    [],
  );
  const loadFiles = useCallback(
    (entries: URDFFileEntry[], label: string) => setSource({ kind: "files", entries, label }),
    [],
  );

  return {
    source,
    robot,
    model,
    values,
    loading,
    progress,
    error,
    onChange,
    resetJoint,
    resetAll,
    loadPreset,
    loadFiles,
  };
}
