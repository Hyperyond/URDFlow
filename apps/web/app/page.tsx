"use client";

import { useURDF } from "../lib/useURDF";
import { RobotViewer } from "../components/RobotViewer";
import { JointPanel } from "../components/JointPanel";

export default function Page() {
  const { robot, model, values, error, onChange } = useURDF("/robots/ur5/ur5.urdf");
  return (
    <main style={{ position: "relative" }}>
      <RobotViewer robot={robot} />
      <div style={{ position: "absolute", top: 0, left: 0, background: "#0009", color: "#fff" }}>
        <JointPanel model={model} values={values} onChange={onChange} />
      </div>
      {error && (
        <div
          role="alert"
          style={{ position: "absolute", bottom: 0, left: 0, padding: 12, background: "#a00", color: "#fff" }}
        >
          Failed to load URDF: {error.message}
        </div>
      )}
    </main>
  );
}
