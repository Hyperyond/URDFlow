"use client";

import { useState, useEffect, useRef, type RefObject } from "react";
import { Canvas } from "@react-three/fiber";
import {
  OrbitControls,
  Grid,
  ContactShadows,
  TransformControls,
  GizmoHelper,
  GizmoViewport,
  Environment,
  Lightformer,
} from "@react-three/drei";
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
  const tableRef = useRef<Mesh>(null);

  // Layer 1 = "capture" layer the front/wrist cameras render (real-looking scene,
  // no editor helpers). Robot + box live on both layers; the matte ground is capture-only.
  useEffect(() => {
    robot?.traverse((o) => o.layers.enable(1));
  }, [robot]);
  useEffect(() => {
    boxMesh?.layers.enable(1);
  }, [boxMesh]);
  useEffect(() => {
    tableRef.current?.layers.enable(1); // table on both layers (viewport + camera feeds)
  }, []);

  return (
    <div className="relative h-full w-full">
      <Canvas
        camera={{ position: [1.4, 1.1, 1.4], fov: 50 }}
        gl={{ toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.15, antialias: true }}
        style={{ height: "100%", width: "100%", background: "#e9ecef" }}
      >
        <color attach="background" args={["#eef1f4"]} />
        {/* image-based lighting — procedural studio env (no network HDR) for realistic PBR */}
        <Environment resolution={256}>
          <Lightformer intensity={1.6} position={[0, 4, -6]} scale={[14, 8, 1]} color="#ffffff" />
          <Lightformer intensity={0.9} position={[-6, 2, 2]} scale={[10, 6, 1]} color="#e8efff" />
          <Lightformer intensity={0.9} position={[6, 2, 2]} scale={[10, 6, 1]} color="#fff3e6" />
          <Lightformer intensity={0.5} position={[0, -4, 1]} scale={[14, 6, 1]} color="#ffffff" />
        </Environment>
        {/* direct lights now just add highlight + shape on top of the IBL */}
        <hemisphereLight args={["#ffffff", "#cdd2da", 0.5]} />
        <ambientLight intensity={0.2} />
        <directionalLight position={[5, 8, 4]} intensity={1.1} color="#fff6ea" />
        <directionalLight position={[-5, 3, -4]} intensity={0.35} color="#9db4ff" />

        {robot && <primitive object={robot} />}
        {captureRefs && (
          <CaptureRig robot={robot} frontCanvas={captureRefs.front} topCanvas={captureRefs.top} boxPosition={boxPosition} />
        )}

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
        {/* work table (both layers): operation surface in the viewport AND the camera feeds */}
        <mesh ref={tableRef} position={[0.15, -0.026, 0.15]}>
          <boxGeometry args={[1.1, 0.05, 1.1]} />
          <meshStandardMaterial color="#c9c2b4" roughness={0.75} metalness={0.05} />
        </mesh>
        <ContactShadows position={[0, 0.001, 0]} opacity={0.5} scale={5} blur={2.6} far={3} />
        <Grid
          args={[10, 10]}
          cellColor="#c8ccd2"
          sectionColor="#aab0ba"
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
