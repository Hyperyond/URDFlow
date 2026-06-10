import { Quaternion } from "three";

export interface Keyframe {
  t: number; // seconds
  position: [number, number, number];
  quaternion: [number, number, number, number]; // xyzw
  gripper: number;
}
export interface EEPoseSample {
  t: number;
  position: [number, number, number];
  quaternion: [number, number, number, number];
  gripper: number;
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;

/** Interpolate keyframes at time t (lerp position/gripper, slerp orientation). Clamps to ends. */
export function interpolateKeyframes(kfs: Keyframe[], t: number): EEPoseSample {
  if (kfs.length === 0) throw new Error("no keyframes");
  const sorted = [...kfs].sort((a, b) => a.t - b.t);
  if (t <= sorted[0]!.t) return { ...sorted[0]!, t };
  if (t >= sorted[sorted.length - 1]!.t) return { ...sorted[sorted.length - 1]!, t };
  let i = 0;
  while (i < sorted.length - 1 && sorted[i + 1]!.t < t) i++;
  const a = sorted[i]!;
  const b = sorted[i + 1]!;
  const u = (t - a.t) / (b.t - a.t);
  const q = new Quaternion(...a.quaternion).slerp(new Quaternion(...b.quaternion), u);
  return {
    t,
    position: [
      lerp(a.position[0], b.position[0], u),
      lerp(a.position[1], b.position[1], u),
      lerp(a.position[2], b.position[2], u),
    ],
    quaternion: [q.x, q.y, q.z, q.w],
    gripper: lerp(a.gripper, b.gripper, u),
  };
}

/** Sample the keyframe span at fps Hz (inclusive of both ends). */
export function sampleTrajectory(kfs: Keyframe[], fps: number): EEPoseSample[] {
  if (kfs.length === 0) return [];
  const sorted = [...kfs].sort((a, b) => a.t - b.t);
  const t0 = sorted[0]!.t;
  const t1 = sorted[sorted.length - 1]!.t;
  const n = Math.max(1, Math.round((t1 - t0) * fps));
  const out: EEPoseSample[] = [];
  for (let i = 0; i <= n; i++) out.push(interpolateKeyframes(sorted, t0 + ((t1 - t0) * i) / n));
  return out;
}
