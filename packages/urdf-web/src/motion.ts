/**
 * Motion-clip model for retargeted robot trajectory data.
 *
 * Native format: OmniRetarget .npz — { fps, qpos[T, D] } where each row is
 *   [qw,qx,qy,qz, x,y,z] floating base (7)
 *   joint positions (nq, e.g. 29 for G1)
 *   optional object pose [qw,qx,qy,qz, x,y,z] (7)
 * World frame is Z-up (Drake/MuJoCo convention); renderers convert to their
 * own up-axis. Joint order follows the URDF's actuated-joint declaration order.
 */

import type { NpyArray } from "./npz.js";

export interface ZUpPose {
  /** position [x, y, z] in the Z-up world */
  pos: [number, number, number];
  /** unit quaternion [w, x, y, z] */
  quat: [number, number, number, number];
}

export interface MotionFrame {
  base: ZUpPose;
  joints: Float64Array;
  object?: ZUpPose;
}

export interface MotionClip {
  fps: number;
  /** number of timesteps */
  frames: number;
  /** row width: 7 + joints (+7 if hasObject) */
  dim: number;
  jointCount: number;
  hasObject: boolean;
  /** duration in seconds */
  duration: number;
  /** flat row-major [T * dim] */
  qpos: Float64Array;
}

const BASE_DIM = 7;
const OBJECT_DIM = 7;

/** Build a MotionClip from parsed npz arrays ({ fps, qpos }). */
export function motionFromNpz(npz: Record<string, NpyArray>): MotionClip {
  const qposArr = npz["qpos"];
  const fpsArr = npz["fps"];
  if (!qposArr) throw new Error("npz missing 'qpos'");
  if (qposArr.shape.length !== 2) throw new Error(`qpos must be 2-D, got shape [${qposArr.shape}]`);
  const [frames, dim] = qposArr.shape as [number, number];
  if (dim < BASE_DIM + 1) throw new Error(`qpos row too short (${dim})`);
  const fps = fpsArr ? Number(fpsArr.data[0]) : 30;
  if (!Number.isFinite(fps) || fps <= 0) throw new Error(`bad fps: ${fps}`);

  const qpos = qposArr.data instanceof Float64Array ? qposArr.data : Float64Array.from(qposArr.data);
  return {
    fps,
    frames,
    dim,
    jointCount: dim - BASE_DIM, // provisional until fitJointCount resolves the object
    hasObject: false,
    duration: frames / fps,
    qpos,
  };
}

/**
 * Resolve whether the trailing 7 values are an object pose, given the robot's
 * actuated joint count (from its URDF). E.g. G1: nq=29 → dim 36 = robot only,
 * dim 43 = robot + object.
 */
export function fitJointCount(clip: MotionClip, robotJointCount: number): MotionClip {
  const dimRobotOnly = BASE_DIM + robotJointCount;
  if (clip.dim === dimRobotOnly) {
    return { ...clip, jointCount: robotJointCount, hasObject: false };
  }
  if (clip.dim === dimRobotOnly + OBJECT_DIM) {
    return { ...clip, jointCount: robotJointCount, hasObject: true };
  }
  throw new Error(
    `trajectory width ${clip.dim} does not match robot with ${robotJointCount} joints (expected ${dimRobotOnly} or ${dimRobotOnly + OBJECT_DIM})`,
  );
}

function readPose(qpos: Float64Array, off: number): ZUpPose {
  // stored [qw,qx,qy,qz, x,y,z]
  return {
    quat: [qpos[off]!, qpos[off + 1]!, qpos[off + 2]!, qpos[off + 3]!],
    pos: [qpos[off + 4]!, qpos[off + 5]!, qpos[off + 6]!],
  };
}

/** Exact frame access (no interpolation). */
export function frameAt(clip: MotionClip, index: number): MotionFrame {
  const i = Math.max(0, Math.min(clip.frames - 1, Math.round(index)));
  const row = i * clip.dim;
  const joints = clip.qpos.subarray(row + BASE_DIM, row + BASE_DIM + clip.jointCount);
  const frame: MotionFrame = { base: readPose(clip.qpos, row), joints: Float64Array.from(joints) };
  if (clip.hasObject) frame.object = readPose(clip.qpos, row + BASE_DIM + clip.jointCount);
  return frame;
}

function nlerp(
  a: [number, number, number, number],
  b: [number, number, number, number],
  t: number,
): [number, number, number, number] {
  // shortest arc, normalized lerp — indistinguishable from slerp at frame-to-frame angles
  const dot = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const s = dot < 0 ? -1 : 1;
  const w = a[0] + (s * b[0] - a[0]) * t;
  const x = a[1] + (s * b[1] - a[1]) * t;
  const y = a[2] + (s * b[2] - a[2]) * t;
  const z = a[3] + (s * b[3] - a[3]) * t;
  const n = Math.hypot(w, x, y, z) || 1;
  return [w / n, x / n, y / n, z / n];
}

function lerpPose(a: ZUpPose, b: ZUpPose, t: number): ZUpPose {
  return {
    pos: [
      a.pos[0] + (b.pos[0] - a.pos[0]) * t,
      a.pos[1] + (b.pos[1] - a.pos[1]) * t,
      a.pos[2] + (b.pos[2] - a.pos[2]) * t,
    ],
    quat: nlerp(a.quat, b.quat, t),
  };
}

/** Interpolated sample at an arbitrary time (seconds), clamped to [0, duration]. */
export function sampleAt(clip: MotionClip, timeSec: number): MotionFrame {
  const ft = Math.max(0, Math.min(clip.frames - 1, timeSec * clip.fps));
  const i0 = Math.floor(ft);
  const i1 = Math.min(clip.frames - 1, i0 + 1);
  const t = ft - i0;
  if (t === 0 || i0 === i1) return frameAt(clip, i0);

  const a = frameAt(clip, i0);
  const b = frameAt(clip, i1);
  const joints = new Float64Array(clip.jointCount);
  for (let j = 0; j < clip.jointCount; j++) joints[j] = a.joints[j]! + (b.joints[j]! - a.joints[j]!) * t;
  const frame: MotionFrame = { base: lerpPose(a.base, b.base, t), joints };
  if (a.object && b.object) frame.object = lerpPose(a.object, b.object, t);
  return frame;
}
