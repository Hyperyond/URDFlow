# G1 walking policy weights

`g1_walk_lstm.json` — weights extracted from the pre-trained checkpoint
`deploy/pre_train/g1/motion.pt` in [unitree_rl_gym](https://github.com/unitreerobotics/unitree_rl_gym)
(BSD-3-Clause, © Unitree Robotics). Architecture: LSTM(47→64) → Linear(64→32) → ELU →
Linear(32→12); raw float32 tensors, base64-encoded, little-endian.

Observation layout (47), scales, PD gains and default angles follow the upstream deploy
config `deploy/deploy_mujoco/configs/g1.yaml`; the forward pass is re-implemented in
`apps/web/app/lab/walk/physics.worker.ts`.
