"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid } from "@react-three/drei";
import type { URDFRobot } from "@urdflow/urdf-web";

export function RobotViewer({ robot }: { robot: URDFRobot | null }) {
  return (
    <Canvas
      camera={{ position: [1.5, 1.5, 1.5], fov: 50 }}
      style={{ height: "100vh", background: "#1a1a1a" }}
    >
      <ambientLight intensity={0.6} />
      <directionalLight position={[3, 5, 2]} intensity={1.2} />
      <Grid args={[10, 10]} cellColor="#444" sectionColor="#666" infiniteGrid />
      {robot && <primitive object={robot} />}
      <OrbitControls />
    </Canvas>
  );
}
