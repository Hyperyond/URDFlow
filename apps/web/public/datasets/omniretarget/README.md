# Bundled sample trajectories

From the [OmniRetarget Dataset](https://huggingface.co/datasets/omniretarget/OmniRetarget_Dataset)
(MIT License, © the OmniRetarget authors / Amazon FAR) — retargeted Unitree G1 motion clips:

- `climb_00.npz` — terrain climbing (`robot-terrain/climb_00_z_scale_1.0.npz`),
  with its terrain model `climb_00_terrain.urdf` + `box_models/box1.obj`
- `chair_carry.npz` — chair interaction (`robot-object-terrain/scene_01_chair_scaled_1.2.npz`),
  with the matching `chair_scaled_1.2.urdf`

Format per file: `{ fps, qpos[T, 36|43] }`, rows are
`[qw,qx,qy,qz, x,y,z]` base + 29 joints (+ optional object pose, same layout).
