"use client";

import { useEffect, useState, useCallback } from "react";
import {
  loadURDFFromURL,
  getJointModel,
  setJoint,
  type JointInfo,
  type URDFRobot,
} from "@urdflow/urdf-web";

export function useURDF(url: string) {
  const [robot, setRobot] = useState<URDFRobot | null>(null);
  const [model, setModel] = useState<JointInfo[]>([]);
  const [values, setValues] = useState<Record<string, number>>({});
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let alive = true;
    // Clear prior robot synchronously so a URL change can't leave onChange
    // mutating the stale robot during the load gap.
    setRobot(null);
    setModel([]);
    setValues({});
    setError(null);
    loadURDFFromURL(url, { packages: "/robots/" })
      .then((r) => {
        if (!alive) return;
        setRobot(r);
        setModel(getJointModel(r));
      })
      .catch((e) => {
        if (!alive) return;
        setError(e instanceof Error ? e : new Error(String(e)));
      });
    return () => {
      alive = false;
    };
  }, [url]);

  const onChange = useCallback(
    (name: string, value: number) => {
      if (!robot) return;
      setJoint(robot, name, value);
      setValues((v) => ({ ...v, [name]: value }));
    },
    [robot],
  );

  return { robot, model, values, error, onChange };
}
