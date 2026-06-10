import { describe, it, expect } from "vitest";
import { loadURDFFromFiles } from "../src/loadURDF";
import { twoJointArmURDF } from "./fixtures/two-joint-arm";

function entry(path: string, text: string) {
  return { path, data: new TextEncoder().encode(text).buffer as ArrayBuffer };
}

describe("loadURDFFromFiles", () => {
  it("finds the .urdf among entries and parses joints", async () => {
    const robot = await loadURDFFromFiles([
      entry("two_joint_arm/robot.urdf", twoJointArmURDF),
      entry("two_joint_arm/readme.txt", "ignore me"),
    ]);
    expect(robot.robotName).toBe("two_joint_arm");
    expect(Object.keys(robot.joints).sort()).toEqual(["joint1", "joint2"]);
  });

  it("rejects when no .urdf present", async () => {
    await expect(loadURDFFromFiles([entry("x.txt", "no urdf")])).rejects.toThrow(/no \.urdf/i);
  });
});
