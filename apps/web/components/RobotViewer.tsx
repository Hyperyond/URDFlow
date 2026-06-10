"use client";

import { useEffect, useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, ContactShadows, TransformControls, SoftShadows } from "@react-three/drei";
import { ACESFilmicToneMapping, type Mesh, type Object3D } from "three";
import type { URDFRobot } from "@urdflow/urdf-web";

export interface RobotViewerProps {
  robot: URDFRobot | null;
  boxPosition?: [number, number, number];
  onBoxMove?: (p: [number, number, number]) => void;
}

export function RobotViewer({ robot, boxPosition, onBoxMove }: RobotViewerProps) {
  // ref-callback into state so TransformControls mounts once the mesh exists
  const [boxMesh, setBoxMesh] = useState<Mesh | null>(null);

  // URDF meshes don't cast/receive shadows by default — turn them on.
  useEffect(() => {
    robot?.traverse((o: Object3D) => {
      const m = o as Mesh;
      if (m.isMesh) {
        m.castShadow = true;
        m.receiveShadow = true;
      }
    });
  }, [robot]);

  return (
    <div className="relative h-screen">
      <Canvas
        shadows
        dpr={[1, 2]}
        camera={{ position: [1.4, 1.1, 1.4], fov: 50 }}
        gl={{ toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.05, antialias: true }}
        style={{ height: "100vh", background: "#0e1014" }}
      >
        <SoftShadows size={28} samples={12} focus={0.6} />

        {/* sky/ground fill + warm key (shadow caster) + cool rim */}
        <hemisphereLight args={["#dfe7ff", "#20242c", 0.7]} />
        <ambientLight intensity={0.12} />
        <directionalLight
          position={[4, 7, 3]}
          intensity={2.1}
          color="#fff4e6"
          castShadow
          shadow-mapSize={[2048, 2048]}
          shadow-bias={-0.0002}
          shadow-camera-left={-1.5}
          shadow-camera-right={1.5}
          shadow-camera-top={1.5}
          shadow-camera-bottom={-1.5}
          shadow-camera-near={0.5}
          shadow-camera-far={20}
        />
        <directionalLight position={[-5, 3, -4]} intensity={0.45} color="#9db4ff" />

        {robot && <primitive object={robot} />}

        {/* Draggable target box — user positions it, planGrasp aims for it. */}
        {boxPosition && (
          <mesh ref={setBoxMesh} position={boxPosition} castShadow>
            <boxGeometry args={[0.05, 0.05, 0.05]} />
            <meshStandardMaterial color="#22d3ee" emissive="#0e7490" emissiveIntensity={0.4} roughness={0.4} />
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

        {/* Matte ground receiving shadows, with grid + soft contact shadow on top */}
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[40, 40]} />
          <meshStandardMaterial color="#15181e" roughness={0.96} metalness={0} />
        </mesh>
        <ContactShadows position={[0, 0.002, 0]} opacity={0.45} scale={5} blur={2.6} far={3} />
        <Grid
          args={[10, 10]}
          position={[0, 0.001, 0]}
          cellColor="#23262e"
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
