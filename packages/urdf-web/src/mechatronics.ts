import type { JointInfo } from "./types";

export interface Actuator {
  name: string;
  position: number;
  target: number;
  maxVel: number;
}

export interface JointSignal {
  name: string;
  encoder: number;
  moving: boolean;
  atTarget: boolean;
  atLowerLimit: boolean;
  atUpperLimit: boolean;
}

const AT_TARGET_EPS = 1e-3;
const clamp = (x: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, x));

/** One zeroed actuator per movable joint (generic across joint types). */
export function createActuators(model: JointInfo[], defaultMaxVel = 1.0): Actuator[] {
  return model.map((m) => ({ name: m.name, position: 0, target: 0, maxVel: defaultMaxVel }));
}

/** Advance each actuator toward its target by at most maxVel*dt; clamp to limits (except continuous). */
export function stepActuators(actuators: Actuator[], model: JointInfo[], dt: number): Actuator[] {
  const byName = new Map(model.map((m) => [m.name, m]));
  return actuators.map((a) => {
    const maxStep = a.maxVel * dt;
    const delta = clamp(a.target - a.position, -maxStep, maxStep);
    let next = a.position + delta;
    const m = byName.get(a.name);
    if (m && m.type !== "continuous") next = clamp(next, m.lower, m.upper);
    return { ...a, position: next };
  });
}

/** Derive sensor signals from actuator state + joint limits. */
export function computeSignals(actuators: Actuator[], model: JointInfo[]): JointSignal[] {
  const byName = new Map(model.map((m) => [m.name, m]));
  return actuators.map((a) => {
    const moving = Math.abs(a.target - a.position) > AT_TARGET_EPS;
    const m = byName.get(a.name);
    let atLowerLimit = false;
    let atUpperLimit = false;
    if (m && m.type !== "continuous") {
      const eps = (m.upper - m.lower) * 0.02;
      atLowerLimit = a.position <= m.lower + eps;
      atUpperLimit = a.position >= m.upper - eps;
    }
    return { name: a.name, encoder: a.position, moving, atTarget: !moving, atLowerLimit, atUpperLimit };
  });
}
