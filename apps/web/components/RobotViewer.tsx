"use client";

import { useState } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Grid, ContactShadows, TransformControls } from "@react-three/drei";
import type { Object3D } from "three";
import type { URDFRobot } from "@urdflow/urdf-web";

export interface RobotViewerProps {
  robot: URDFRobot | null;
  gizmoTarget?: Object3D;
  onGizmoMove?: () => void;
}

export function RobotViewer({ robot, gizmoTarget, onGizmoMove }: RobotViewerProps) {
  const [mode, setMode] = useState<"translate" | "rotate">("translate");
  return (
    <div className="relative h-screen">
      {gizmoTarget && (
        <button
          onClick={() => setMode((m) => (m === "translate" ? "rotate" : "translate"))}
          className="absolute right-3 top-3 z-10 rounded bg-white/10 px-2 py-1 text-[11px] uppercase tracking-wider text-zinc-300 backdrop-blur"
        >
          {mode === "translate" ? "move" : "rotate"} · toggle
        </button>
      )}
      <Canvas camera={{ position: [1.3, 1.0, 1.3], fov: 50 }} style={{ height: "100vh", background: "#15171c" }}>
        {/* Studio-ish lighting: sky/ground fill + key + rim. No HDR/network dep. */}
        <hemisphereLight args={["#ffffff", "#3a3f4b", 1.0]} />
        <ambientLight intensity={0.25} />
        <directionalLight position={[5, 8, 4]} intensity={1.5} />
        <directionalLight position={[-4, 3, -5]} intensity={0.5} />

        {robot && <primitive object={robot} />}
        {gizmoTarget && (
          <>
            <primitive object={gizmoTarget} />
            <TransformControls object={gizmoTarget} mode={mode} size={0.7} onObjectChange={() => onGizmoMove?.()} />
          </>
        )}

        {/* Fake contact shadow grounds the arm without per-mesh shadow flags. */}
        <ContactShadows position={[0, 0.001, 0]} opacity={0.5} scale={4} blur={2.4} far={3} />
        <Grid args={[10, 10]} cellColor="#23262e" sectionColor="#363b46" fadeDistance={18} fadeStrength={1.5} infiniteGrid />
        <OrbitControls makeDefault target={[0, 0.45, 0]} />
      </Canvas>
    </div>
  );
}
