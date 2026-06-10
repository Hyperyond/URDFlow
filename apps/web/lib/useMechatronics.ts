"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createActuators,
  stepActuators,
  computeSignals,
  setJoint,
  type Actuator,
  type JointSignal,
  type JointInfo,
  type URDFRobot,
} from "@urdflow/urdf-web";

export function useMechatronics(robot: URDFRobot | null, model: JointInfo[]) {
  const actuatorsRef = useRef<Actuator[]>([]);
  const [actuators, setActuators] = useState<Actuator[]>([]);
  const [signals, setSignals] = useState<JointSignal[]>([]);

  useEffect(() => {
    actuatorsRef.current = createActuators(model);
    setActuators(actuatorsRef.current);
    setSignals(computeSignals(actuatorsRef.current, model));
    if (!robot || model.length === 0) return;

    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.1); // clamp big gaps (tab refocus)
      last = now;
      const next = stepActuators(actuatorsRef.current, model, dt);
      actuatorsRef.current = next;
      for (const a of next) setJoint(robot, a.name, a.position);
      setActuators(next);
      setSignals(computeSignals(next, model));
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [robot, model]);

  const setTarget = useCallback((name: string, value: number) => {
    actuatorsRef.current = actuatorsRef.current.map((a) => (a.name === name ? { ...a, target: value } : a));
    setActuators(actuatorsRef.current);
  }, []);
  const home = useCallback(() => {
    actuatorsRef.current = actuatorsRef.current.map((a) => ({ ...a, target: 0 }));
    setActuators(actuatorsRef.current);
  }, []);
  const stop = useCallback(() => {
    actuatorsRef.current = actuatorsRef.current.map((a) => ({ ...a, target: a.position }));
    setActuators(actuatorsRef.current);
  }, []);

  const targets: Record<string, number> = {};
  for (const a of actuators) targets[a.name] = a.target;

  return { actuators, signals, targets, setTarget, home, stop };
}
