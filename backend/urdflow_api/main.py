"""
URDFlow backend (FastAPI).

The heavy half of the data workbench — the work the browser can't do: turning
QC-passed motion clips into a training-bound dataset, and (later) launching and
monitoring runs against holosoma / Isaac Lab. The browser keeps the live,
zero-install half (QC, playback); this service owns export, conversion, and
training orchestration.

Run:  uv run uvicorn urdflow_api.main:app --reload --port 8000
"""

from __future__ import annotations

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response

from . import __version__
from .convert import build_dataset, load_clip

app = FastAPI(title="URDFlow API", version=__version__)

# the Next.js workbench talks to us from these origins in dev
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:3210"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok", "version": __version__, "service": "urdflow-api"}


@app.post("/export/lerobot")
async def export_lerobot(
    files: list[UploadFile] = File(...),
    robot_joint_count: int = Form(29),
    robot_type: str = Form("g1_29dof"),
    joint_names: str | None = Form(None),
) -> Response:
    """
    QC-passed .npz motion clips → a zipped LeRobot-shaped motion dataset.
    `joint_names` is an optional comma-separated list (URDF movable-joint order).
    """
    if not files:
        raise HTTPException(400, "no files uploaded")
    names = [n.strip() for n in joint_names.split(",")] if joint_names else None

    clips = []
    for f in files:
        data = await f.read()
        try:
            clips.append(load_clip(f.filename or "clip.npz", data, robot_joint_count))
        except ValueError as e:
            raise HTTPException(422, str(e)) from e

    try:
        zip_bytes = build_dataset(clips, robot_type=robot_type, joint_names=names)
    except ValueError as e:
        raise HTTPException(422, str(e)) from e

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="urdflow_lerobot_{len(clips)}ep.zip"'},
    )
