import { describe, it, expect } from "vitest";
import { createActuators, stepActuators, computeSignals } from "../src/mechatronics";
import type { JointInfo } from "../src/types";

const rev = (name: string, lower = -1, upper = 1): JointInfo => ({ name, type: "revolute", lower, upper });

describe("createActuators", () => {
  it("builds one zeroed actuator per joint with default maxVel", () => {
    const acts = createActuators([rev("j1"), rev("j2")], 2);
    expect(acts).toEqual([
      { name: "j1", position: 0, target: 0, maxVel: 2 },
      { name: "j2", position: 0, target: 0, maxVel: 2 },
    ]);
  });
  it("defaults maxVel to 1.0", () => {
    expect(createActuators([rev("j1")])[0]!.maxVel).toBe(1.0);
  });
});

describe("stepActuators", () => {
  const model = [rev("j1", -1, 1)];
  it("advances toward target by at most maxVel*dt", () => {
    const acts = [{ name: "j1", position: 0, target: 1, maxVel: 1 }];
    expect(stepActuators(acts, model, 0.1)[0]!.position).toBeCloseTo(0.1, 6);
  });
  it("reaches target without overshoot when within one step", () => {
    const acts = [{ name: "j1", position: 0.95, target: 1, maxVel: 1 }];
    expect(stepActuators(acts, model, 0.1)[0]!.position).toBeCloseTo(1.0, 6);
  });
  it("clamps to joint limits", () => {
    const acts = [{ name: "j1", position: 0.95, target: 5, maxVel: 1 }];
    expect(stepActuators(acts, model, 0.1)[0]!.position).toBeCloseTo(1.0, 6);
  });
  it("does not clamp continuous joints", () => {
    const cont: JointInfo[] = [{ name: "c", type: "continuous", lower: -Math.PI, upper: Math.PI }];
    const acts = [{ name: "c", position: 3.1, target: 10, maxVel: 1 }];
    expect(stepActuators(acts, cont, 0.1)[0]!.position).toBeCloseTo(3.2, 6);
  });
});

describe("computeSignals", () => {
  const model = [rev("j1", -1, 1)];
  it("flags moving vs atTarget", () => {
    expect(computeSignals([{ name: "j1", position: 0, target: 0.5, maxVel: 1 }], model)[0]).toMatchObject({
      moving: true,
      atTarget: false,
      encoder: 0,
    });
    expect(computeSignals([{ name: "j1", position: 0.5, target: 0.5, maxVel: 1 }], model)[0]).toMatchObject({
      moving: false,
      atTarget: true,
    });
  });
  it("flags lower/upper limit within 2% of span", () => {
    const lo = computeSignals([{ name: "j1", position: -1, target: -1, maxVel: 1 }], model)[0]!;
    expect(lo.atLowerLimit).toBe(true);
    expect(lo.atUpperLimit).toBe(false);
    const hi = computeSignals([{ name: "j1", position: 1, target: 1, maxVel: 1 }], model)[0]!;
    expect(hi.atUpperLimit).toBe(true);
  });
  it("never flags limits for continuous joints", () => {
    const cont: JointInfo[] = [{ name: "c", type: "continuous", lower: -Math.PI, upper: Math.PI }];
    const s = computeSignals([{ name: "c", position: Math.PI, target: Math.PI, maxVel: 1 }], cont)[0]!;
    expect(s.atLowerLimit).toBe(false);
    expect(s.atUpperLimit).toBe(false);
  });
});
