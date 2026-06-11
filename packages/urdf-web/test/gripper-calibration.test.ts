import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Object3D } from "three";
import { loadURDFFromString } from "../src/loadURDF";
import { findGripperJoints, calibrateGripper, applyGripperCalibrated } from "../src/gripper";
import { stlMeshLoaderFor } from "./helpers/stlMeshes";
import type { URDFRobot } from "urdf-loader";

const ROBOTS = resolve(__dirname, "../../../apps/web/public/robots");

function loadWithMeshes(rel: string): URDFRobot {
  const dir = resolve(ROBOTS, rel, "..");
  const xml = readFileSync(resolve(ROBOTS, rel), "utf-8");
  return loadURDFFromString(xml, { loadMeshCb: stlMeshLoaderFor(dir) });
}

describe("calibrateGripper (real meshes)", () => {
  it("PiPER: finds the true open/closed ends regardless of axis sign conventions", () => {
    const robot = loadWithMeshes("piper/piper.urdf");
    const joints = findGripperJoints(robot);
    const calib = calibrateGripper(robot, joints);
    expect(calib).not.toBeNull();
    // parallel jaw with 2×35mm travel: open gap well above the cube, closed ~touching
    expect(calib!.openGap).toBeGreaterThan(0.05);
    expect(calib!.closedGap).toBeLessThan(0.02);
    // closing on a 50mm cube must stop with the jaws ~50mm apart
    applyGripperCalibrated(robot, calib!, 1, 0.05);
    robot.updateMatrixWorld(true);
    const gap = calib!.measureGap();
    expect(Math.abs(gap - 0.05)).toBeLessThan(0.012);
  });

  it("SO-101: calibrated closure parks the clamps at the cube width", () => {
    const robot = loadWithMeshes("so101_gripper/so101_gripper.urdf");
    const joints = findGripperJoints(robot);
    const calib = calibrateGripper(robot, joints);
    expect(calib).not.toBeNull();
    expect(calib!.openGap).toBeGreaterThan(0.05);
    applyGripperCalibrated(robot, calib!, 1, 0.05);
    robot.updateMatrixWorld(true);
    expect(Math.abs(calib!.measureGap() - 0.05)).toBeLessThan(0.012);
  });

  it("SO-100: single revolute jaw closes to the cube width instead of slicing through", () => {
    const robot = loadWithMeshes("so100/so100.urdf");
    const joints = findGripperJoints(robot);
    expect(joints.map((j) => j.name)).toEqual(["gripper"]);
    const calib = calibrateGripper(robot, joints);
    expect(calib).not.toBeNull();
    // jaw can open past the cube and close near zero
    expect(calib!.openGap).toBeGreaterThan(0.05);
    expect(calib!.closedGap).toBeLessThan(0.025);
    applyGripperCalibrated(robot, calib!, 1, 0.05);
    robot.updateMatrixWorld(true);
    expect(Math.abs(calib!.measureGap() - 0.05)).toBeLessThan(0.015);
    // and fully open never exceeds the joint limits
    applyGripperCalibrated(robot, calib!, 0, 0.05);
    const a = robot.joints["gripper"]!.angle as number;
    expect(a).toBeGreaterThanOrEqual(-0.2 - 1e-6);
    expect(a).toBeLessThanOrEqual(2.0 + 1e-6);
  });

  it("returns null when the robot has no gripper meshes to measure", () => {
    const robot = loadURDFFromString(
      readFileSync(resolve(ROBOTS, "piper/piper.urdf"), "utf-8"),
      // no meshes at all → nothing to measure
      { loadMeshCb: (_p, _m, done) => done(new Object3D()) },
    );
    const joints = findGripperJoints(robot);
    expect(calibrateGripper(robot, joints)).toBeNull();
  });
});

describe("openAxis (finger separation direction)", () => {
  it.each([
    ["piper/piper.urdf"],
    ["so101_gripper/so101_gripper.urdf"],
    ["g1/g1.urdf"],
  ])("%s: pads separate roughly perpendicular to the approach axis", (rel) => {
    const robot = loadWithMeshes(rel);
    const joints = findGripperJoints(robot);
    // humanoids carry two hands — calibrate one hand's pair only
    const side = joints.filter((j) => j.name.startsWith("left_"));
    const calib = calibrateGripper(robot, side.length >= 2 ? side : joints)!;
    expect(calib).not.toBeNull();
    const open = calib.openAxis;
    expect(Math.hypot(...open)).toBeCloseTo(1, 3);
    const tcpLen = Math.hypot(...calib.tcp);
    const approach = calib.tcp.map((v) => v / tcpLen);
    const dot = Math.abs(open[0] * approach[0]! + open[1] * approach[1]! + open[2] * approach[2]!);
    expect(dot).toBeLessThan(0.45); // separation ⊥-ish to approach — fingers straddle, not stab
  });
});
