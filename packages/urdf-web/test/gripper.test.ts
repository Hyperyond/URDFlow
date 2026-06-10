import { describe, it, expect } from "vitest";
import { loadURDFFromString } from "../src/loadURDF";
import { findGripperJoints, applyGripper } from "../src/gripper";
import { gripperArmURDF } from "./fixtures/gripper-arm";
import { twoJointArmURDF } from "./fixtures/two-joint-arm";

describe("findGripperJoints", () => {
  it("finds prismatic finger joints by name", () => {
    const robot = loadURDFFromString(gripperArmURDF);
    const g = findGripperJoints(robot);
    expect(g.map((j) => j.name)).toEqual(["panda_finger_joint1", "panda_finger_joint2"]);
    expect(g[0]!.upper).toBeCloseTo(0.04, 6);
    expect(g[0]!.lower).toBeCloseTo(0, 6);
  });
  it("returns [] when the robot has no gripper", () => {
    const robot = loadURDFFromString(twoJointArmURDF);
    expect(findGripperJoints(robot)).toEqual([]);
  });
});

describe("applyGripper", () => {
  it("opens at 0 (upper) and closes at 1 (lower)", () => {
    const robot = loadURDFFromString(gripperArmURDF);
    const g = findGripperJoints(robot);
    applyGripper(robot, g, 0);
    expect(robot.joints["panda_finger_joint1"]!.angle as number).toBeCloseTo(0.04, 4);
    applyGripper(robot, g, 1);
    expect(robot.joints["panda_finger_joint1"]!.angle as number).toBeCloseTo(0, 4);
  });
});
