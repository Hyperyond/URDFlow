import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Quaternion, Euler } from "three";
import { urdfToMJCF, rpyToQuat } from "../src/mjcf";

const ROBOTS = resolve(__dirname, "../../../apps/web/public/robots");
const urdf = (rel: string) => readFileSync(resolve(ROBOTS, rel), "utf-8");

describe("rpyToQuat", () => {
  it("matches three.js extrinsic XYZ (intrinsic ZYX) for arbitrary angles", () => {
    for (const [r, p, y] of [
      [0.3, -0.7, 1.2],
      [Math.PI / 2, 0, 0],
      [0, 0, -Math.PI / 4],
      [-1.1, 0.4, 2.9],
    ] as const) {
      // URDF rpy is fixed-axis XYZ = R = Rz(y)·Ry(p)·Rx(r) = intrinsic ZYX
      const tq = new Quaternion().setFromEuler(new Euler(r, p, y, "ZYX"));
      const [w, qx, qy, qz] = rpyToQuat(r, p, y);
      // same rotation up to sign
      const dot = Math.abs(w * tq.w + qx * tq.x + qy * tq.y + qz * tq.z);
      expect(dot).toBeCloseTo(1, 10);
    }
  });
});

describe("urdfToMJCF on the Panda", () => {
  const result = urdfToMJCF(urdf("panda/panda.urdf"), {
    objects: [{ name: "cube-0", halfExtents: [0.025, 0.025, 0.025], pos: [0.5, 0, 0.025], mass: 0.05, free: true }],
  });

  it("emits a well-formed XML document", () => {
    const doc = new DOMParser().parseFromString(result.xml, "text/xml");
    expect(doc.querySelector("parsererror")).toBeNull();
    expect(doc.querySelector("mujoco > worldbody > body")).not.toBeNull();
  });

  it("keeps the 7 arm joints + 2 finger joints in tree order", () => {
    expect(result.jointNames).toEqual([
      "panda_joint1",
      "panda_joint2",
      "panda_joint3",
      "panda_joint4",
      "panda_joint5",
      "panda_joint6",
      "panda_joint7",
      "panda_finger_joint1",
      "panda_finger_joint2",
    ]);
  });

  it("mimic finger joint becomes an equality, not an actuator", () => {
    expect(result.actuators).toContain("panda_finger_joint1");
    expect(result.actuators).not.toContain("panda_finger_joint2");
    expect(result.xml).toMatch(/<equality>[\s\S]*joint1="panda_finger_joint2" joint2="panda_finger_joint1"/);
  });

  it("collision meshes are STL assets; .dae visuals never enter physics", () => {
    expect(result.meshes.length).toBeGreaterThan(0);
    for (const m of result.meshes) {
      expect(m.path).toMatch(/collision\/.*\.stl$/i);
      expect(m.file).toMatch(/\.stl$/);
    }
    expect(result.xml).not.toMatch(/\.dae/);
  });

  it("free cube gets a freejoint and is listed in freeBodies", () => {
    expect(result.freeBodies).toEqual(["cube-0"]);
    expect(result.xml).toMatch(/<body name="cube-0" pos="0.5 0 0.025">\s*<freejoint/);
  });

  it("actuators carry joint limits as ctrlrange and effort as forcerange", () => {
    expect(result.xml).toMatch(
      /<position name="panda_joint1" joint="panda_joint1" kp="2500" kv="120" ctrlrange="-2.8973 2.8973" forcerange="-87 87"\/>/,
    );
    // prismatic finger gets the linear gains
    expect(result.xml).toMatch(/<position name="panda_finger_joint1"[^/]*kp="2000" kv="100"/);
  });

  it("masks robot self-collision but keeps robot↔scene contact", () => {
    expect(result.xml).toMatch(/<geom contype="1" conaffinity="2"/); // default (robot)
    expect(result.xml).toMatch(/name="ground" type="plane" size="10 10 0.1" contype="2" conaffinity="3"/);
  });

  it("inertials survive with positive masses", () => {
    const masses = [...result.xml.matchAll(/<inertial[^>]*mass="([^"]+)"/g)].map((m) => Number(m[1]));
    expect(masses.length).toBeGreaterThan(5);
    expect(masses.every((m) => m > 0)).toBe(true);
  });
});

describe("urdfToMJCF across the preset fleet", () => {
  for (const rel of [
    "so101_gripper/so101_gripper.urdf",
    "so101/so101.urdf",
    "so100/so100.urdf",
    "ur5/ur5.urdf",
    "piper/piper.urdf",
    "g1/g1.urdf",
    "h1/h1.urdf",
  ]) {
    it(`compiles ${rel} without throwing`, () => {
      const r = urdfToMJCF(urdf(rel));
      expect(r.jointNames.length).toBeGreaterThan(3);
      expect(new DOMParser().parseFromString(r.xml, "text/xml").querySelector("parsererror")).toBeNull();
    });
  }
});
