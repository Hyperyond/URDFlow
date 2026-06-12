import io

import numpy as np
from fastapi.testclient import TestClient

from urdflow_api.main import app

client = TestClient(app)


def make_npz(frames: int, joints: int) -> bytes:
    dim = 7 + joints
    qpos = np.zeros((frames, dim), dtype=np.float64)
    qpos[:, 0] = 1.0
    buf = io.BytesIO()
    np.savez(buf, fps=np.float64(30.0), qpos=qpos)
    return buf.getvalue()


def test_health():
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_export_endpoint_returns_zip():
    files = [
        ("files", ("a.npz", make_npz(6, 29), "application/octet-stream")),
        ("files", ("b.npz", make_npz(4, 29), "application/octet-stream")),
    ]
    r = client.post("/export/lerobot", files=files, data={"robot_joint_count": "29"})
    assert r.status_code == 200
    assert r.headers["content-type"] == "application/zip"
    assert r.content[:2] == b"PK"


def test_export_rejects_mismatched_joints():
    files = [("files", ("a.npz", make_npz(6, 29), "application/octet-stream"))]
    r = client.post("/export/lerobot", files=files, data={"robot_joint_count": "12"})
    assert r.status_code == 422
