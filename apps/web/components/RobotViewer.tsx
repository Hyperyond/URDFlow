"use client";

import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, ContactShadows } from "@react-three/drei";
import type { URDFRobot } from "@urdflow/urdf-web";

export function RobotViewer({ robot }: { robot: URDFRobot | null }) {
  return (
    <Canvas
      camera={{ position: [1.3, 1.0, 1.3], fov: 50 }}
      style={{ height: "100vh", background: "#15171c" }}
    >
      {/* Studio-ish lighting: sky/ground fill + key + rim. No HDR/network dep. */}
      <hemisphereLight args={["#ffffff", "#3a3f4b", 1.0]} />
      <ambientLight intensity={0.25} />
      <directionalLight position={[5, 8, 4]} intensity={1.5} />
      <directionalLight position={[-4, 3, -5]} intensity={0.5} />

      {robot && <primitive object={robot} />}

      {/* Fake contact shadow grounds the arm without per-mesh shadow flags. */}
      <ContactShadows position={[0, 0.001, 0]} opacity={0.5} scale={4} blur={2.4} far={3} />
      <Grid
        args={[10, 10]}
        cellColor="#23262e"
        sectionColor="#363b46"
        fadeDistance={18}
        fadeStrength={1.5}
        infiniteGrid
      />
      <OrbitControls makeDefault target={[0, 0.45, 0]} />
    </Canvas>
  );
}
