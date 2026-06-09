import { describe, it, expect } from "vitest";
import { loadURDFFromString } from "../src/loadURDF";
import { twoJointArmURDF } from "./fixtures/two-joint-arm";

const urdf = twoJointArmURDF;

describe("loadURDFFromString", () => {
  it("parses the robot name and both movable joints", () => {
    const robot = loadURDFFromString(urdf);
    expect(robot.robotName).toBe("two_joint_arm");
    expect(Object.keys(robot.joints).sort()).toEqual(["joint1", "joint2"]);
    expect(robot.joints["joint1"]?.jointType).toBe("revolute");
  });

  it("applies Z-up to Y-up by default", () => {
    const robot = loadURDFFromString(urdf);
    expect(robot.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
  });

  it("leaves the frame untouched when convertUpAxis is false", () => {
    const robot = loadURDFFromString(urdf, { convertUpAxis: false });
    expect(robot.rotation.x).toBeCloseTo(0, 5);
  });
});
