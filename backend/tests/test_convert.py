import io
import json
import zipfile

import numpy as np
import pyarrow.parquet as pq
import pytest

from urdflow_api.convert import build_dataset, clip_to_table, load_clip


def make_npz(frames: int, joints: int, with_object: bool, fps: float = 50.0) -> bytes:
    dim = 7 + joints + (7 if with_object else 0)
    qpos = np.zeros((frames, dim), dtype=np.float64)
    for t in range(frames):
        qpos[t, 0] = 1.0  # qw
        qpos[t, 4] = t * 0.1  # x walks forward
        qpos[t, 6] = 0.79  # z
        for j in range(joints):
            qpos[t, 7 + j] = j + t * 0.01
        if with_object:
            qpos[t, 7 + joints] = 1.0
            qpos[t, 7 + joints + 4] = 1.5
    buf = io.BytesIO()
    np.savez(buf, fps=np.float64(fps), qpos=qpos)
    return buf.getvalue()


def test_load_clip_robot_only():
    clip = load_clip("c.npz", make_npz(10, 29, False), 29)
    assert clip.joint_count == 29
    assert clip.has_object is False
    assert clip.qpos.shape == (10, 36)
    assert clip.fps == 50.0


def test_load_clip_with_object():
    clip = load_clip("c.npz", make_npz(4, 29, True), 29)
    assert clip.has_object is True
    assert clip.qpos.shape == (4, 43)


def test_load_clip_rejects_mismatch():
    with pytest.raises(ValueError, match="doesn't match"):
        load_clip("c.npz", make_npz(4, 29, False), 12)


def test_clip_to_table_columns_and_values():
    clip = load_clip("c.npz", make_npz(5, 29, True), 29)
    table = clip_to_table(clip, episode_index=3)
    assert table.num_rows == 5
    assert "observation.object_pose" in table.column_names
    # base x at frame 2 is 0.2
    base = table.column("observation.base_pose").to_pylist()
    assert base[2][4] == pytest.approx(0.2, abs=1e-5)
    assert table.column("episode_index").to_pylist() == [3] * 5
    # timestamp at frame 2 = 2/50
    ts = table.column("timestamp").to_pylist()
    assert ts[2] == pytest.approx(2 / 50, abs=1e-5)


def test_build_dataset_zip_layout_and_roundtrip():
    clips = [
        load_clip("climb.npz", make_npz(10, 29, False), 29),
        load_clip("carry.npz", make_npz(8, 29, True), 29),
    ]
    zip_bytes = build_dataset(clips, robot_type="g1_29dof", joint_names=[f"j{i}" for i in range(29)])

    z = zipfile.ZipFile(io.BytesIO(zip_bytes))
    names = set(z.namelist())
    assert "meta/info.json" in names
    assert "meta/episodes.jsonl" in names
    assert "data/chunk-000/episode_000000.parquet" in names
    assert "data/chunk-000/episode_000001.parquet" in names

    info = json.loads(z.read("meta/info.json"))
    assert info["total_episodes"] == 2
    assert info["total_frames"] == 18
    assert info["robot_type"] == "g1_29dof"
    assert info["features"]["observation.joint_pos"]["shape"] == [29]
    assert info["features"]["observation.joint_pos"]["names"][0] == "j0"
    # object feature present because one clip carries an object
    assert "observation.object_pose" in info["features"]

    # parquet round-trips and matches frame counts
    ep0 = pq.read_table(io.BytesIO(z.read("data/chunk-000/episode_000000.parquet")))
    assert ep0.num_rows == 10
    episodes = [json.loads(line) for line in z.read("meta/episodes.jsonl").decode().splitlines()]
    assert [e["length"] for e in episodes] == [10, 8]
    assert episodes[0]["source"] == "climb.npz"


def test_build_dataset_empty_rejected():
    with pytest.raises(ValueError, match="no clips"):
        build_dataset([])
