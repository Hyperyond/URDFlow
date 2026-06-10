"use client";

import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, ContactShadows, TransformControls } from "@react-three/drei";
import { ACESFilmicToneMapping, type Mesh } from "three";
import type { URDFRobot } from "@urdflow/urdf-web";

export interface RobotViewerProps {
  robot: URDFRobot | null;
  boxPosition?: [number, number, number];
  onBoxMove?: (p: [number, number, number]) => void;
}

export function RobotViewer({ robot, boxPosition, onBoxMove }: RobotViewerProps) {
  // ref-callback into state so TransformControls mounts once the mesh exists
  const [boxMesh, setBoxMesh] = useState<Mesh | null>(null);

  return (
    <div className="relative h-screen">
      <Canvas
        camera={{ position: [1.4, 1.1, 1.4], fov: 50 }}
        gl={{ toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.15, antialias: true }}
        style={{ height: "100vh", background: "#14171d" }}
      >
        {/* sky/ground fill + warm key + cool rim — brighter, no shadow-map (kept simple) */}
        <hemisphereLight args={["#eaf0ff", "#2a2f38", 1.1]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[5, 8, 4]} intensity={1.8} color="#fff4e6" />
        <directionalLight position={[-5, 3, -4]} intensity={0.6} color="#9db4ff" />

        {robot && <primitive object={robot} />}

        {/* Draggable target box — user positions it, planGrasp aims for it. */}
        {boxPosition && (
          <mesh ref={setBoxMesh} position={boxPosition}>
            <boxGeometry args={[0.05, 0.05, 0.05]} />
            <meshStandardMaterial color="#22d3ee" emissive="#0e7490" emissiveIntensity={0.45} roughness={0.4} />
          </mesh>
        )}
        {boxMesh && boxPosition && (
          <TransformControls
            object={boxMesh}
            mode="translate"
            size={0.6}
            onObjectChange={() => {
              const p = boxMesh.position;
              onBoxMove?.([p.x, p.y, p.z]);
            }}
          />
        )}

        {/* Soft fake contact shadow grounds the arm without a solid ground plane. */}
        <ContactShadows position={[0, 0.001, 0]} opacity={0.5} scale={5} blur={2.6} far={3} />
        <Grid
          args={[10, 10]}
          cellColor="#262a33"
          sectionColor="#3a4150"
          fadeDistance={20}
          fadeStrength={1.6}
          infiniteGrid
        />
        <OrbitControls makeDefault target={[0, 0.45, 0]} minDistance={0.6} maxDistance={6} />
      </Canvas>
    </div>
  );
}
