import { describe, it, expect } from "vitest";
import { loadURDFFromString } from "../src/loadURDF";
import { getJointModel, setJoint } from "../src/joints";
import { twoJointArmURDF } from "./fixtures/two-joint-arm";

describe("getJointModel", () => {
  it("returns only movable joints with their type and limits", () => {
    const model = getJointModel(loadURDFFromString(twoJointArmURDF));
    expect(model).toEqual([
      { name: "joint1", type: "revolute", lower: -1.57, upper: 1.57 },
      { name: "joint2", type: "revolute", lower: -1.0, upper: 1.0 },
    ]);
  });
});

describe("setJoint", () => {
  it("drives forward kinematics for the named joint", () => {
    const robot = loadURDFFromString(twoJointArmURDF);
    const changed = setJoint(robot, "joint1", 0.5);
    expect(changed).toBe(true);
    expect(robot.joints["joint1"]!.angle).toBeCloseTo(0.5, 5);
  });

  it("returns false for an unknown joint", () => {
    const robot = loadURDFFromString(twoJointArmURDF);
    expect(setJoint(robot, "nope", 0.5)).toBe(false);
  });
});
