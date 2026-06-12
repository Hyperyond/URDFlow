"""
Motion-clip → columnar training dataset.

Input clips are OmniRetarget-style ``.npz`` files: ``{ fps, qpos[T, D] }`` where
each row is ``[qw,qx,qy,qz, x,y,z]`` floating base (7) + joint positions (nq) +
optional object pose (7). These are *motion references* (qpos over time), the
shape holosoma / motion-tracking RL consumes directly.

We emit a LeRobot-shaped layout — ``meta/info.json``, ``meta/episodes.jsonl``,
``data/chunk-000/episode_*.parquet`` — so it drops into familiar tooling, while
being honest that the features are motion-reference, not teleop observation/action.

Pure numpy + pyarrow: no torch, no GPU, no LeRobot dependency. Fully testable.
"""

from __future__ import annotations

import io
import json
import zipfile
from dataclasses import dataclass

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq

BASE_DIM = 7
OBJECT_DIM = 7
CODEBASE_VERSION = "urdflow-motion-v1"


@dataclass
class Clip:
    name: str
    fps: float
    qpos: np.ndarray  # [T, D], float
    joint_count: int
    has_object: bool


def load_clip(name: str, data: bytes, robot_joint_count: int) -> Clip:
    """Parse a .npz byte blob and resolve its layout against the robot's joint count."""
    with np.load(io.BytesIO(data)) as npz:
        if "qpos" not in npz:
            raise ValueError(f"{name}: npz missing 'qpos'")
        qpos = np.asarray(npz["qpos"], dtype=np.float64)
        fps = float(npz["fps"]) if "fps" in npz else 30.0
    if qpos.ndim != 2:
        raise ValueError(f"{name}: qpos must be 2-D, got shape {qpos.shape}")
    dim = qpos.shape[1]
    dim_robot_only = BASE_DIM + robot_joint_count
    if dim == dim_robot_only:
        has_object = False
    elif dim == dim_robot_only + OBJECT_DIM:
        has_object = True
    else:
        raise ValueError(
            f"{name}: width {dim} doesn't match a {robot_joint_count}-joint robot "
            f"(expected {dim_robot_only} or {dim_robot_only + OBJECT_DIM})"
        )
    if fps <= 0:
        raise ValueError(f"{name}: bad fps {fps}")
    return Clip(name=name, fps=fps, qpos=qpos, joint_count=robot_joint_count, has_object=has_object)


def clip_to_table(clip: Clip, episode_index: int) -> pa.Table:
    """One episode → an Arrow table, one row per frame."""
    T = clip.qpos.shape[0]
    base = clip.qpos[:, 0:BASE_DIM].astype(np.float32)
    joints = clip.qpos[:, BASE_DIM : BASE_DIM + clip.joint_count].astype(np.float32)

    cols: dict[str, pa.Array] = {
        "timestamp": pa.array(np.arange(T, dtype=np.float32) / np.float32(clip.fps)),
        "frame_index": pa.array(np.arange(T, dtype=np.int64)),
        "episode_index": pa.array(np.full(T, episode_index, dtype=np.int64)),
        "observation.base_pose": pa.array(base.tolist(), type=pa.list_(pa.float32(), BASE_DIM)),
        "observation.joint_pos": pa.array(joints.tolist(), type=pa.list_(pa.float32(), clip.joint_count)),
    }
    if clip.has_object:
        obj = clip.qpos[:, BASE_DIM + clip.joint_count :].astype(np.float32)
        cols["observation.object_pose"] = pa.array(obj.tolist(), type=pa.list_(pa.float32(), OBJECT_DIM))
    return pa.table(cols)


def _features(joint_count: int, joint_names: list[str] | None, any_object: bool) -> dict:
    names = joint_names if joint_names and len(joint_names) == joint_count else [f"joint_{i}" for i in range(joint_count)]
    feats = {
        "timestamp": {"dtype": "float32", "shape": [1]},
        "frame_index": {"dtype": "int64", "shape": [1]},
        "episode_index": {"dtype": "int64", "shape": [1]},
        "observation.base_pose": {"dtype": "float32", "shape": [BASE_DIM], "names": ["qw", "qx", "qy", "qz", "x", "y", "z"]},
        "observation.joint_pos": {"dtype": "float32", "shape": [joint_count], "names": names},
    }
    if any_object:
        feats["observation.object_pose"] = {"dtype": "float32", "shape": [OBJECT_DIM], "names": ["qw", "qx", "qy", "qz", "x", "y", "z"]}
    return feats


def build_dataset(
    clips: list[Clip],
    robot_type: str = "g1_29dof",
    joint_names: list[str] | None = None,
) -> bytes:
    """Assemble clips into a zip of the LeRobot-shaped motion dataset."""
    if not clips:
        raise ValueError("no clips to export")
    joint_count = clips[0].joint_count
    fps = clips[0].fps
    any_object = any(c.has_object for c in clips)

    buf = io.BytesIO()
    total_frames = 0
    episodes_meta: list[dict] = []

    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for i, clip in enumerate(clips):
            table = clip_to_table(clip, i)
            pbuf = io.BytesIO()
            pq.write_table(table, pbuf)
            z.writestr(f"data/chunk-000/episode_{i:06d}.parquet", pbuf.getvalue())
            length = clip.qpos.shape[0]
            total_frames += length
            episodes_meta.append({"episode_index": i, "length": length, "source": clip.name, "tasks": []})

        info = {
            "codebase_version": CODEBASE_VERSION,
            "robot_type": robot_type,
            "fps": fps,
            "total_episodes": len(clips),
            "total_frames": total_frames,
            "chunks_size": 1000,
            "data_path": "data/chunk-{episode_chunk:03d}/episode_{episode_index:06d}.parquet",
            "features": _features(joint_count, joint_names, any_object),
        }
        z.writestr("meta/info.json", json.dumps(info, indent=2))
        z.writestr("meta/episodes.jsonl", "\n".join(json.dumps(e) for e in episodes_meta) + "\n")

    return buf.getvalue()
