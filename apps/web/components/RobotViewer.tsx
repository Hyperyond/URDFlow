"use client";

import { useState, useEffect, useRef, type RefObject } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, ContactShadows, TransformControls, GizmoHelper, GizmoViewport } from "@react-three/drei";
import { ACESFilmicToneMapping, type Mesh } from "three";
import type { URDFRobot } from "@urdflow/urdf-web";
import { CaptureRig } from "./CaptureRig";

export interface RobotViewerProps {
  robot: URDFRobot | null;
  boxPosition?: [number, number, number];
  onBoxMove?: (p: [number, number, number]) => void;
  captureRefs?: { front: RefObject<HTMLCanvasElement | null>; top: RefObject<HTMLCanvasElement | null> };
}

export function RobotViewer({ robot, boxPosition, onBoxMove, captureRefs }: RobotViewerProps) {
  // ref-callback into state so TransformControls mounts once the mesh exists
  const [boxMesh, setBoxMesh] = useState<Mesh | null>(null);
  const groundRef = useRef<Mesh>(null);

  // Layer 1 = "capture" layer the front/wrist cameras render (real-looking scene,
  // no editor helpers). Robot + box live on both layers; the matte ground is capture-only.
  useEffect(() => {
    robot?.traverse((o) => o.layers.enable(1));
  }, [robot]);
  useEffect(() => {
    boxMesh?.layers.enable(1);
  }, [boxMesh]);
  useEffect(() => {
    groundRef.current?.layers.set(1);
  }, []);

  return (
    <div className="relative h-full w-full">
      <Canvas
        camera={{ position: [1.4, 1.1, 1.4], fov: 50 }}
        gl={{ toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.15, antialias: true }}
        style={{ height: "100%", width: "100%", background: "#1b1f27" }}
      >
        {/* sky/ground fill + warm key + cool rim — brighter, no shadow-map (kept simple) */}
        <hemisphereLight args={["#eaf0ff", "#2a2f38", 1.1]} />
        <ambientLight intensity={0.35} />
        <directionalLight position={[5, 8, 4]} intensity={1.8} color="#fff4e6" />
        <directionalLight position={[-5, 3, -4]} intensity={0.6} color="#9db4ff" />

        {robot && <primitive object={robot} />}
        {captureRefs && <CaptureRig frontCanvas={captureRefs.front} topCanvas={captureRefs.top} />}

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
        {/* capture-only matte ground (layer 1) so cameras see a real floor, not the grid */}
        <mesh ref={groundRef} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
          <planeGeometry args={[20, 20]} />
          <meshStandardMaterial color="#1a1d24" roughness={1} metalness={0} />
        </mesh>
        <ContactShadows position={[0, 0.001, 0]} opacity={0.5} scale={5} blur={2.6} far={3} />
        <Grid
          args={[10, 10]}
          cellColor="#262a33"
          sectionColor="#3a4150"
          fadeDistance={20}
          fadeStrength={1.6}
          infiniteGrid
        />
        {/* PlayCanvas/Blender-style orientation gizmo (东南西北) */}
        <GizmoHelper alignment="top-right" margin={[64, 64]}>
          <GizmoViewport axisColors={["#ef4444", "#22c55e", "#3b82f6"]} labelColor="#e5e7eb" />
        </GizmoHelper>
        <OrbitControls makeDefault target={[0, 0.45, 0]} minDistance={0.6} maxDistance={6} />
      </Canvas>
    </div>
  );
}
