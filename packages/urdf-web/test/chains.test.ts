import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Object3D } from "three";
import { loadURDFFromString } from "../src/loadURDF";
import { findKinematicChains } from "../src/chains";

const ROBOTS = resolve(__dirname, "../../../apps/web/public/robots");
const noMesh = (_p: string, _m: unknown, done: (o: Object3D) => void) => done(new Object3D());
const load = (rel: string) =>
  loadURDFFromString(readFileSync(resolve(ROBOTS, rel), "utf-8"), { loadMeshCb: noMesh });

describe("findKinematicChains", () => {
  it("a plain arm is a single chain matching the old joint list", () => {
    const robot = load("panda/panda.urdf");
    const chains = findKinematicChains(robot);
    expect(chains).toHaveLength(1);
    expect(chains[0]!.joints).toEqual([
      "panda_joint1",
      "panda_joint2",
      "panda_joint3",
      "panda_joint4",
      "panda_joint5",
      "panda_joint6",
      "panda_joint7",
    ]);
    expect(chains[0]!.gripperJoints).toEqual(["panda_finger_joint1", "panda_finger_joint2"]);
  });

  it("G1 humanoid: arms with grippers outrank legs; each hand's fingers stay on their own arm", () => {
    const robot = load("g1/g1.urdf");
    const chains = findKinematicChains(robot);
    expect(chains.length).toBeGreaterThanOrEqual(4); // 2 arms + 2 legs at least
    const top = chains[0]!;
    expect(top.gripperJoints).toHaveLength(2); // one Dex1 pair, not both hands
    expect(top.joints.join(",")).toMatch(/shoulder|elbow|wrist/);
    expect(top.joints.join(",")).not.toMatch(/hip|knee|ankle/);
    // both arms found, with side-specific fingers
    const arms = chains.filter((c) => c.gripperJoints.length === 2);
    expect(arms).toHaveLength(2);
    const left = arms.find((c) => c.joints.some((j) => j.startsWith("left_")));
    expect(left).toBeDefined();
    expect(left!.gripperJoints.every((g) => g.startsWith("left_"))).toBe(true);
    // legs exist but rank below the arms
    const legs = chains.filter((c) => /hip|knee|ankle/.test(c.joints.join(",")));
    expect(legs.length).toBeGreaterThanOrEqual(2);
    for (const leg of legs) expect(leg.score).toBeLessThan(top.score);
  });

  it("H1 humanoid (no hands): arms still outrank legs via name heuristics", () => {
    const robot = load("h1/h1.urdf");
    const chains = findKinematicChains(robot);
    expect(chains.length).toBeGreaterThanOrEqual(4);
    const top = chains[0]!;
    expect(top.gripperJoints).toHaveLength(0);
    expect(top.joints.join(",")).toMatch(/shoulder|elbow/);
    expect(top.joints.join(",")).not.toMatch(/hip|knee|ankle/);
  });
});
