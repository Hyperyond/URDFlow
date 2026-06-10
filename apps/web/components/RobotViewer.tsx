"use client";

import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, ContactShadows, TransformControls } from "@react-three/drei";
import type { Mesh } from "three";
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
      <Canvas camera={{ position: [1.3, 1.0, 1.3], fov: 50 }} style={{ height: "100vh", background: "#15171c" }}>
        {/* Studio-ish lighting: sky/ground fill + key + rim. No HDR/network dep. */}
        <hemisphereLight args={["#ffffff", "#3a3f4b", 1.0]} />
        <ambientLight intensity={0.25} />
        <directionalLight position={[5, 8, 4]} intensity={1.5} />
        <directionalLight position={[-4, 3, -5]} intensity={0.5} />

        {robot && <primitive object={robot} />}

        {/* Draggable target box — user positions it, planGrasp aims for it. */}
        {boxPosition && (
          <mesh ref={setBoxMesh} position={boxPosition}>
            <boxGeometry args={[0.05, 0.05, 0.05]} />
            <meshStandardMaterial color="#22d3ee" emissive="#0e7490" emissiveIntensity={0.4} />
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

        {/* Fake contact shadow grounds the arm without per-mesh shadow flags. */}
        <ContactShadows position={[0, 0.001, 0]} opacity={0.5} scale={4} blur={2.4} far={3} />
        <Grid args={[10, 10]} cellColor="#23262e" sectionColor="#363b46" fadeDistance={18} fadeStrength={1.5} infiniteGrid />
        <OrbitControls makeDefault target={[0, 0.45, 0]} />
      </Canvas>
    </div>
  );
}
