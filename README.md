# URDFlow

A browser-based workbench for building, simulating, and quality-checking robot
manipulation data — no install, no driver, no SDK. Drop in any URDF robot and it
runs entirely in the browser via WebGL and WebAssembly.

## What it does

- **Load any robot.** Pick a built-in preset (Franka Panda, SO-101, SO-100,
  AgileX PiPER) or drag in your own URDF folder / `.zip`. Meshes (STL, DAE, OBJ,
  glTF) resolve locally — nothing is uploaded.
- **Compose a scene.** Place graspable cubes and drop-off targets, or describe a
  layout in plain language and let it generate one. The two capture cameras
  (`observation.front` / `observation.top`, matching the LeRobot convention) are
  draggable gizmos you can fine-tune in-scene.
- **Plan and play pick-and-place.** Inverse-kinematics grasp planning runs in real
  time, one segment at a time, so the arm starts moving immediately even on large
  scenes. Gripper closure is calibrated against the real finger meshes so the jaws
  stop at the object's faces.
- **Inspect quality.** Kinematic QC over trajectories, batch checks across a
  dataset, and clean-set export — the wedge toward a dataset-quality tool.
- **Export to LeRobot.** Retarget the planned motion to joint-space frames and
  export episodes in LeRobot format.

A MuJoCo WASM physics path (the same engine that drives the in-browser locomotion
lab) backs validation and future contact-accurate grasping.

## Stack

Next.js · React Three Fiber / three.js · a custom URDF + IK + grasp library
(`@urdflow/urdf-web`) · MuJoCo WASM · LeRobot-format export.

## Develop

```bash
pnpm install
pnpm dev        # http://localhost:3000
pnpm test       # unit tests
pnpm build
```

This is a pnpm monorepo: the web app lives in `apps/web`, the URDF/IK/grasp engine
in `packages/urdf-web`.
