import { describe, it, expect } from "vitest";
import { clampScene } from "../lib/sceneTypes";
import { buildScene, SCENE_PRESETS } from "../lib/scenes";
import { localSceneFromPrompt } from "../lib/promptScene";

const ANCHOR = { x: 0.3, z: 0.05, radius: 0.38 };
const dist = (a: { x: number; z: number }, b: { x: number; z: number }) =>
  Math.hypot(a.x - b.x, a.z - b.z);

describe("clampScene", () => {
  it("clamps everything into the reachable annulus and spaces the pieces", () => {
    const scene = clampScene(
      {
        cubes: [
          { x: 2, z: 2 }, // way out of reach
          { x: 0.001, z: 0 }, // on top of the base
          { x: 0.2, z: 0.0 },
          { x: 0.2, z: 0.0 }, // duplicate spot — must be nudged apart
        ],
        targets: [{ x: -3, z: 0 }],
      },
      0.4,
    );
    for (const p of [...scene.cubes, ...scene.targets]) {
      const r = Math.hypot(p.x, p.z);
      expect(r).toBeGreaterThanOrEqual(0.13);
      expect(r).toBeLessThanOrEqual(0.45);
    }
    const all = [...scene.cubes, ...scene.targets];
    for (let i = 0; i < all.length; i++)
      for (let j = i + 1; j < all.length; j++) expect(dist(all[i]!, all[j]!)).toBeGreaterThan(0.06);
  });

  it("caps the piece count at 6 each", () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ x: 0.2 + i * 0.05, z: 0.1 }));
    const scene = clampScene({ cubes: many, targets: many }, 0.9);
    expect(scene.cubes.length).toBeLessThanOrEqual(6);
    expect(scene.targets.length).toBeLessThanOrEqual(6);
  });
});

describe("buildScene presets", () => {
  it.each(SCENE_PRESETS.map((s) => [s.kind] as const))("%s stays inside the workspace", (kind) => {
    const scene = buildScene(kind, ANCHOR);
    expect(scene.cubes.length).toBeGreaterThanOrEqual(3);
    expect(scene.targets.length).toBeGreaterThanOrEqual(1);
    for (const p of [...scene.cubes, ...scene.targets]) {
      expect(Math.hypot(p.x, p.z)).toBeLessThanOrEqual(ANCHOR.radius + 1e-6);
    }
  });

  it("sorting assigns one color per cube", () => {
    const scene = buildScene("sorting", ANCHOR);
    expect(new Set(scene.cubes.map((c) => c.color)).size).toBe(scene.cubes.length);
  });
});

describe("localSceneFromPrompt", () => {
  it("parses counts and colors from English prompts", () => {
    const scene = localSceneFromPrompt("generate 4 red cubes in a row", ANCHOR);
    expect(scene.cubes).toHaveLength(4);
    expect(scene.cubes[0]!.color).toBe("#f87171");
  });

  it("maps scene keywords to the presets", () => {
    const scene = localSceneFromPrompt("give me a sorting scene", ANCHOR);
    expect(scene.cubes.length).toBe(3);
    expect(scene.targets.length).toBe(3);
  });

  it("digit counts cap at 6", () => {
    const scene = localSceneFromPrompt("12 cubes", ANCHOR);
    expect(scene.cubes.length).toBeLessThanOrEqual(6);
  });
});

describe("localSceneFromPrompt noun-bound counts", () => {
  it("binds counts to their nouns (cubes vs targets)", () => {
    const scene = localSceneFromPrompt("four yellow cubes in a grid, two targets", ANCHOR);
    expect(scene.cubes).toHaveLength(4);
    expect(scene.targets).toHaveLength(2);
    expect(scene.cubes[0]!.color).toBe("#fbbf24");
  });
});
