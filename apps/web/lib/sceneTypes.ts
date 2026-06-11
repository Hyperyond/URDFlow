/** Declarative scene: cube/target ground positions in meters, robot base at origin. */
export interface SceneSpec {
  cubes: { x: number; z: number; color?: string }[];
  targets: { x: number; z: number }[];
}

/** Clamp a scene into the robot's reachable annulus and de-overlap the pieces. */
export function clampScene(scene: SceneSpec, radius: number): SceneSpec {
  const rMin = 0.14;
  const rMax = Math.max(rMin + 0.05, radius);
  const clampPt = (x: number, z: number): [number, number] => {
    const r = Math.hypot(x, z);
    if (r < 1e-6) return [rMin, 0];
    const cl = Math.min(Math.max(r, rMin), rMax);
    return [(x / r) * cl, (z / r) * cl];
  };
  const seen: [number, number][] = [];
  const spaced = (x: number, z: number): [number, number] => {
    let [px, pz] = [x, z];
    for (let tries = 0; tries < 8; tries++) {
      const tooClose = seen.some(([sx, sz]) => Math.hypot(sx - px, sz - pz) < 0.08);
      if (!tooClose) break;
      // nudge outward around the base until it stops overlapping
      const a = Math.atan2(pz, px) + 0.18;
      const r = Math.min(Math.hypot(px, pz) + 0.02, rMax);
      px = Math.cos(a) * r;
      pz = Math.sin(a) * r;
    }
    seen.push([px, pz]);
    return [px, pz];
  };
  const cubes = scene.cubes.slice(0, 6).map((c) => {
    const [x, z] = spaced(...clampPt(c.x, c.z));
    return { x, z, color: c.color };
  });
  const targets = scene.targets.slice(0, 6).map((t) => {
    const [x, z] = spaced(...clampPt(t.x, t.z));
    return { x, z };
  });
  return { cubes, targets };
}
