import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Object3D, Vector3 } from "three";
import { loadURDFFromString } from "../src/loadURDF";
import { findKinematicChains } from "../src/chains";
import { isMobileBase, applyBasePose, computeApproachBase } from "../src/base";
import { findToolFrame } from "../src/tool";
import { toolWorldPosition } from "../src/ik";
import { chainGrippers } from "../src/chains";

const ROBOTS = resolve(__dirname, "../../../apps/web/public/robots");
const noMesh = (_p: string, _m: unknown, done: (o: Object3D) => void) => done(new Object3D());
const load = (rel: string) =>
  loadURDFFromString(readFileSync(resolve(ROBOTS, rel), "utf-8"), { loadMeshCb: noMesh });

describe("isMobileBase", () => {
  it("humanoids with legs are mobile; bolted-down arms are not", () => {
    const g1 = load("g1/g1.urdf");
    expect(isMobileBase(g1, findKinematicChains(g1))).toBe(true);
    const panda = load("panda/panda.urdf");
    expect(isMobileBase(panda, findKinematicChains(panda))).toBe(false);
  });
});

describe("applyBasePose + computeApproachBase", () => {
  it("walking the base to the approach pose brings the hand anchor onto the cube", () => {
    const robot = load("g1/g1.urdf");
    const chains = findKinematicChains(robot);
    const arm = chains[0]!;
    // raise the arm so the hand has a usable forward anchor
    const side = arm.joints.some((j) => j.startsWith("left_")) ? "left" : "right";
    robot.setJointValue(`${side}_shoulder_pitch_joint`, -0.4);
    robot.setJointValue(`${side}_elbow_joint`, 0.9);
    applyBasePose(robot, { x: 0, z: 0, yaw: 0 });
    const tool = findToolFrame(robot, chainGrippers(robot, arm));
    const anchor0 = toolWorldPosition(robot, tool.link, tool.offset);

    // a cube far away in some arbitrary direction
    const cube: [number, number] = [1.6, 0.9];
    const next = computeApproachBase(
      { x: 0, z: 0, yaw: 0 },
      [anchor0.x, anchor0.z],
      cube,
    );
    applyBasePose(robot, next);
    const anchor1 = toolWorldPosition(robot, tool.link, tool.offset);
    // after the walk, the hand's hover anchor sits on the cube's ground position
    expect(Math.hypot(anchor1.x - cube[0], anchor1.z - cube[1])).toBeLessThan(0.02);
    // and the anchor height is preserved (pure planar base motion)
    expect(Math.abs(anchor1.y - anchor0.y)).toBeLessThan(1e-6);
  });

  it("keeps the robot's up-axis conversion intact (yaw composes with the Z-up fix)", () => {
    const robot = load("g1/g1.urdf");
    applyBasePose(robot, { x: 0.5, z: -0.3, yaw: 1.2 });
    robot.updateMatrixWorld(true);
    // pelvis up direction must still be world +Y after any yaw
    const up = new Vector3(0, 0, 1).applyQuaternion(robot.quaternion);
    expect(up.y).toBeGreaterThan(0.999);
    expect(robot.position.x).toBeCloseTo(0.5, 6);
    expect(robot.position.z).toBeCloseTo(-0.3, 6);
  });
});

describe("walk-then-grasp (G1, real meshes)", () => {
  it("an out-of-reach cube becomes plannable after the approach walk", { timeout: 60000 }, async () => {
    const { stlMeshLoaderFor } = await import("./helpers/stlMeshes");
    const dir = resolve(ROBOTS, "g1");
    const robot = loadURDFFromString(readFileSync(resolve(dir, "g1.urdf"), "utf-8"), {
      loadMeshCb: stlMeshLoaderFor(dir),
    });
    const { planGrasp } = await import("../src/grasp");
    const { calibrateGripper } = await import("../src/gripper");
    const chains = findKinematicChains(robot);
    const arm = chains[0]!;
    const grips = chainGrippers(robot, arm);
    const side = arm.joints.some((j) => j.startsWith("left_")) ? "left" : "right";
    robot.setJointValue(`${side}_shoulder_pitch_joint`, -0.4);
    robot.setJointValue(`${side}_shoulder_roll_joint`, side === "left" ? 0.25 : -0.25);
    robot.setJointValue(`${side}_elbow_joint`, 0.9);
    applyBasePose(robot, { x: 0, z: 0, yaw: 0 });
    const calib = calibrateGripper(robot, grips)!;
    const tool = {
      link: calib.palmLink,
      offset: calib.tcp,
      axis: (() => {
        const l = Math.hypot(...calib.tcp);
        return [calib.tcp[0] / l, calib.tcp[1] / l, calib.tcp[2] / l] as [number, number, number];
      })(),
    };
    const anchor = toolWorldPosition(robot, tool.link, tool.offset);
    const rest = arm.joints.map((j) => robot.joints[j]!.angle as number);
    // a cube ~1.5m away at the same working height — far outside the arm
    const cube: [number, number, number] = [anchor.x + 1.2, anchor.y - 0.18, anchor.z + 0.8];
    const opts = {
      candidates: 36,
      reachThreshold: 0.05,
      approachWeight: 2.0,
      tcpOffset: tool.offset,
      toolAxis: tool.axis,
      minApproachY: 0.25,
      clearance: 0.025,
      restPose: rest,
    };
    expect(planGrasp(robot, tool.link, arm.joints, cube, opts)).toBeNull(); // truly out of reach
    // walk to the standoff, then it plans
    const next = computeApproachBase({ x: 0, z: 0, yaw: 0 }, [anchor.x, anchor.z], [cube[0], cube[2]]);
    applyBasePose(robot, next);
    const plan = planGrasp(robot, tool.link, arm.joints, cube, opts);
    expect(plan).not.toBeNull();
  });
});

describe("planBasePath (obstacle-aware base glide)", () => {
  const table = { minX: -0.5, maxX: 0.5, minZ: -0.4, maxZ: 0.4 };

  it("goes straight when nothing is in the way", async () => {
    const { planBasePath } = await import("../src/base");
    const path = planBasePath([-1, 1], [1, 1], [table], 0.25);
    expect(path).toEqual([[1, 1]]);
  });

  it("detours around a table that blocks the straight line", async () => {
    const { planBasePath } = await import("../src/base");
    const path = planBasePath([-1.2, 0], [1.2, 0], [table], 0.25);
    expect(path.length).toBeGreaterThanOrEqual(2); // waypoint(s) + destination
    expect(path[path.length - 1]).toEqual([1.2, 0]);
    // every leg keeps clear of the inflated footprint
    const inflated = { minX: -0.75, maxX: 0.75, minZ: -0.65, maxZ: 0.65 };
    const pts = [[-1.2, 0], ...path] as [number, number][];
    for (let i = 0; i + 1 < pts.length; i++) {
      for (let u = 0; u <= 10; u++) {
        const x = pts[i]![0] + ((pts[i + 1]![0] - pts[i]![0]) * u) / 10;
        const z = pts[i]![1] + ((pts[i + 1]![1] - pts[i]![1]) * u) / 10;
        const inside =
          x > inflated.minX + 1e-6 && x < inflated.maxX - 1e-6 && z > inflated.minZ + 1e-6 && z < inflated.maxZ - 1e-6;
        expect(inside).toBe(false);
      }
    }
  });

  it("gives up gracefully (straight line) when start or goal sits inside the obstacle", async () => {
    const { planBasePath } = await import("../src/base");
    const path = planBasePath([0, 0], [1.2, 0], [table], 0.25);
    expect(path[path.length - 1]).toEqual([1.2, 0]);
  });
});
