import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Object3D } from "three";
import { loadURDFFromString } from "../src/loadURDF";
import { findKinematicChains } from "../src/chains";
import { planGrasp } from "../src/grasp";
import { findToolFrame } from "../src/tool";

const ROBOTS = resolve(__dirname, "../../../apps/web/public/robots");
const noMesh = (_p: string, _m: unknown, done: (o: Object3D) => void) => done(new Object3D());

describe("planGrasp timeBudgetMs", () => {
  it("an unreachable target fails within the budget instead of scanning all candidates", () => {
    const robot = loadURDFFromString(readFileSync(resolve(ROBOTS, "panda/panda.urdf"), "utf-8"), {
      loadMeshCb: noMesh,
    });
    const chain = findKinematicChains(robot)[0]!;
    const tool = findToolFrame(robot);
    const t0 = performance.now();
    // 3 m away — far outside the Panda's ~0.85 m reach
    const plan = planGrasp(robot, tool.link, chain.joints, [3, 0.3, 0], {
      candidates: 36,
      timeBudgetMs: 250,
      tcpOffset: tool.offset,
      toolAxis: tool.axis,
    });
    const elapsed = performance.now() - t0;
    expect(plan).toBeNull();
    expect(elapsed).toBeLessThan(1200); // budget + one in-flight candidate, not a multi-second scan
  });
});
