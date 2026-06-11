import { describe, expect, it } from "vitest";
import { loadURDFFromString } from "../src/loadURDF";
import { analyzeClip, findFootLinks } from "../src/qc";
import type { MotionClip } from "../src/motion";

/**
 * Minimal Z-up biped: base at the hip, two prismatic "legs" ending in foot
 * links 0.5m below the base. Prismatic joints along Z let tests raise/lower
 * each foot directly.
 */
const BIPED = `<?xml version="1.0"?>
<robot name="biped">
  <link name="base"/>
  <link name="left_foot"/>
  <link name="right_foot"/>
  <joint name="left_leg" type="prismatic">
    <parent link="base"/><child link="left_foot"/>
    <origin xyz="0 0.1 -0.5" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-0.2" upper="0.2" effort="10" velocity="1"/>
  </joint>
  <joint name="right_leg" type="prismatic">
    <parent link="base"/><child link="right_foot"/>
    <origin xyz="0 -0.1 -0.5" rpy="0 0 0"/>
    <axis xyz="0 0 1"/>
    <limit lower="-0.2" upper="0.2" effort="10" velocity="1"/>
  </joint>
</robot>`;

const FPS = 30;
const JOINTS = ["left_leg", "right_leg"];

/** Build a clip from per-frame [x, y, z, leftLeg, rightLeg] (identity base quat). */
function clip(rows: number[][]): MotionClip {
  const dim = 7 + 2;
  const qpos = new Float64Array(rows.length * dim);
  rows.forEach((r, t) => {
    const o = t * dim;
    qpos[o] = 1; // qw
    qpos[o + 4] = r[0]!;
    qpos[o + 5] = r[1]!;
    qpos[o + 6] = r[2]!;
    qpos[o + 7] = r[3]!;
    qpos[o + 8] = r[4]!;
  });
  return {
    fps: FPS,
    frames: rows.length,
    dim,
    jointCount: 2,
    hasObject: false,
    duration: rows.length / FPS,
    qpos,
  };
}

function robot() {
  return loadURDFFromString(BIPED);
}

describe("qc analyzeClip", () => {
  it("detects foot links by name", () => {
    expect(findFootLinks(robot()).sort()).toEqual(["left_foot", "right_foot"]);
  });

  it("gives a clean standing clip a perfect score", () => {
    // base at z=0.5 → feet exactly on the ground, not moving
    const rows = Array.from({ length: 30 }, () => [0, 0, 0.5, 0, 0]);
    const r = analyzeClip(robot(), clip(rows), { jointNames: JOINTS });
    expect(r.score).toBe(100);
    expect(r.issues).toEqual([]);
  });

  it("flags foot skating when the base glides with planted feet", () => {
    // base slides 1.5 m in 1 s with both feet on the ground = classic glide
    const rows = Array.from({ length: 30 }, (_, t) => [t * 0.05, 0, 0.5, 0, 0]);
    const r = analyzeClip(robot(), clip(rows), { jointNames: JOINTS });
    expect(r.metrics.footSkateDistance).toBeGreaterThan(0.5);
    expect(r.issues.some((i) => i.type === "foot_skate")).toBe(true);
    expect(r.score).toBeLessThan(80);
  });

  it("does not flag a swing foot moving above the ground", () => {
    // right foot lifted well clear (leg +0.15) and swinging while left supports
    const rows = Array.from({ length: 30 }, (_, t) => [0, 0, 0.5, 0, 0.15 + 0.04 * Math.sin(t / 3)]);
    const r = analyzeClip(robot(), clip(rows), { jointNames: JOINTS });
    expect(r.issues.filter((i) => i.type === "foot_skate")).toEqual([]);
  });

  it("flags ground penetration", () => {
    // base sinks: feet end up 8 cm under the floor for a stretch
    const rows = Array.from({ length: 20 }, (_, t) => [0, 0, t < 10 ? 0.5 : 0.42, 0, 0]);
    const r = analyzeClip(robot(), clip(rows), { jointNames: JOINTS });
    expect(r.metrics.maxPenetration).toBeGreaterThan(0.05);
    const pen = r.issues.find((i) => i.type === "ground_penetration");
    expect(pen).toBeDefined();
    expect(pen!.link).toMatch(/foot/);
  });

  it("flags joint-limit violations with the worst offender", () => {
    const rows = Array.from({ length: 10 }, () => [0, 0, 0.6, 0.35, 0]); // left_leg over +0.2 limit
    const r = analyzeClip(robot(), clip(rows), { jointNames: JOINTS });
    const v = r.issues.find((i) => i.type === "joint_limit");
    expect(v?.joint).toBe("left_leg");
    expect(r.metrics.maxLimitOvershoot).toBeCloseTo(0.15, 2);
  });

  it("flags base teleports", () => {
    const rows = Array.from({ length: 10 }, (_, t) => [t === 5 ? 2 : 0, 0, 0.6, 0, 0]);
    const r = analyzeClip(robot(), clip(rows), { jointNames: JOINTS });
    expect(r.metrics.teleportCount).toBeGreaterThanOrEqual(1);
    expect(r.issues.some((i) => i.type === "teleport")).toBe(true);
  });

  it("reports jerk without scoring it", () => {
    // noisy joint
    const rows = Array.from({ length: 30 }, (_, t) => [0, 0, 0.6, (t % 2) * 0.1, 0]);
    const r = analyzeClip(robot(), clip(rows), { jointNames: JOINTS });
    expect(r.metrics.peakJerk).toBeGreaterThan(0);
    expect(r.metrics.peakJerkJoint).toBe("left_leg");
  });
});
