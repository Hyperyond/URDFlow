# URDFlow API (Python backend)

The heavy half of the workbench — the work the browser can't do. The browser
keeps the live, zero-install half (QC, playback); this FastAPI service owns
**export, conversion, and (later) training orchestration**, because that side
lives natively in the Python robotics stack (LeRobot, holosoma, MuJoCo, Isaac).

## Why Python

Everything downstream of "Train" is Python: holosoma, LeRobot, MuJoCo, ONNX
export, Isaac Lab. A Python backend `import`s them directly instead of shelling
out, so the Train flow is one process, not a wrapper around another runtime.

## Stack

FastAPI + uvicorn, numpy + pyarrow for conversion. **No torch / GPU** in this
first slice — everything here is CPU dataset work, fully testable.

## Run

Uses [uv](https://docs.astral.sh/uv/) (a standalone toolchain — sidesteps the
macOS system-Python issues).

```bash
cd backend
uv venv --python 3.12
uv pip install -e ".[dev]"
uv run uvicorn urdflow_api.main:app --reload --port 8000
uv run pytest          # 9 tests
```

## Endpoints

| Method | Path | What |
|---|---|---|
| GET  | `/health` | liveness |
| POST | `/export/lerobot` | QC-passed `.npz` motion clips → zipped LeRobot-shaped motion dataset (`meta/info.json`, `meta/episodes.jsonl`, `data/chunk-000/episode_*.parquet`) |

`/export/lerobot` is multipart: `files[]` (the `.npz` clips), `robot_joint_count`
(default 29), `robot_type`, optional `joint_names` (comma-separated, URDF
movable-joint order).

### Format note

Our clips are **motion references** (qpos over time) — the shape holosoma /
motion-tracking RL consumes. We emit a LeRobot-shaped layout so it drops into
familiar tooling, with features labeled honestly as `observation.base_pose` /
`observation.joint_pos` / `observation.object_pose` (not teleop action/state).

## Roadmap

- holosoma whole-body-tracking config export
- server-side batch QC (GPU, large datasets) — reuses the `urdf-web` metric defs
- launch / monitor a training run, stream checkpoints back to the browser
