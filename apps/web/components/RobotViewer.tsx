"use client";

import { useState, useEffect, type RefObject } from "react";
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
import { ACESFilmicToneMapping, Box3, type Mesh } from "three";
import type { URDFRobot } from "@urdflow/urdf-web";
import { CaptureRig } from "./CaptureRig";

const PEDESTAL_H = 0.3; // robot base height above the ground (mounted on a pedestal)

export interface SceneObj {
  id: string;
  position: [number, number, number];
}

export interface RobotViewerProps {
  robot: URDFRobot | null;
  objects: SceneObj[];
  target: [number, number, number] | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMoveObject: (id: string, p: [number, number, number]) => void;
  onMoveTarget: (p: [number, number, number]) => void;
  captureRefs?: { front: RefObject<HTMLCanvasElement | null>; top: RefObject<HTMLCanvasElement | null> };
}

function DraggableBox({
  position,
  color,
  selected,
  wireframe,
  onSelect,
  onMove,
}: {
  position: [number, number, number];
  color: string;
  selected: boolean;
  wireframe?: boolean;
  onSelect: () => void;
  onMove: (p: [number, number, number]) => void;
}) {
  const [mesh, setMesh] = useState<Mesh | null>(null);
  useEffect(() => {
    mesh?.layers.enable(1);
  }, [mesh]);
  return (
    <>
      <mesh
        ref={setMesh}
        position={position}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        <boxGeometry args={[0.05, 0.05, 0.05]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={selected ? 0.5 : 0.25}
          roughness={0.4}
          wireframe={wireframe}
          transparent={wireframe}
          opacity={wireframe ? 0.7 : 1}
        />
      </mesh>
      {selected && mesh && (
        <TransformControls
          object={mesh}
          mode="translate"
          showY={false}
          size={0.5}
          onObjectChange={() => {
            const p = mesh.position;
            onMove([p.x, p.y, p.z]);
          }}
        />
      )}
    </>
  );
}

export function RobotViewer({
  robot,
  objects,
  target,
  selectedId,
  onSelect,
  onMoveObject,
  onMoveTarget,
  captureRefs,
}: RobotViewerProps) {
  const [robotY, setRobotY] = useState(0);

  useEffect(() => {
    robot?.traverse((o) => o.layers.enable(1));
  }, [robot]);

  // mount the robot on a pedestal: lift so its base sits on top (~0.3m), giving a
  // comfortable top-down reach onto ground objects (no crumple, no floor clipping)
  useEffect(() => {
    if (!robot) {
      setRobotY(0);
      return;
    }
    const fit = () => {
      robot.updateMatrixWorld(true);
      const b = new Box3().setFromObject(robot);
      if (Number.isFinite(b.min.y)) setRobotY(PEDESTAL_H - b.min.y);
    };
    fit();
    const t = setTimeout(fit, 200); // re-fit after async meshes finish loading
    return () => clearTimeout(t);
  }, [robot]);

  return (
    <div className="relative h-full w-full">
      <Canvas
        camera={{ position: [1.4, 1.1, 1.4], fov: 50 }}
        gl={{ toneMapping: ACESFilmicToneMapping, toneMappingExposure: 1.15, antialias: true }}
        style={{ height: "100%", width: "100%", background: "#e9ecef" }}
        onPointerMissed={() => onSelect(null)}
      >
        <color attach="background" args={["#eef1f4"]} />
        {/* image-based lighting — procedural studio env (no network HDR) for realistic PBR */}
        <Environment resolution={256}>
          <Lightformer intensity={1.6} position={[0, 4, -6]} scale={[14, 8, 1]} color="#ffffff" />
          <Lightformer intensity={0.9} position={[-6, 2, 2]} scale={[10, 6, 1]} color="#e8efff" />
          <Lightformer intensity={0.9} position={[6, 2, 2]} scale={[10, 6, 1]} color="#fff3e6" />
          <Lightformer intensity={0.5} position={[0, -4, 1]} scale={[14, 6, 1]} color="#ffffff" />
        </Environment>
        <hemisphereLight args={["#ffffff", "#cdd2da", 0.5]} />
        <ambientLight intensity={0.2} />
        <directionalLight position={[5, 8, 4]} intensity={1.1} color="#fff6ea" />
        <directionalLight position={[-5, 3, -4]} intensity={0.35} color="#9db4ff" />

        {robot && <primitive object={robot} position={[0, robotY, 0]} />}
        {captureRefs && (
          <CaptureRig
            robot={robot}
            frontCanvas={captureRefs.front}
            topCanvas={captureRefs.top}
            boxPosition={objects[0]?.position}
          />
        )}

        {/* scene objects: cubes to grasp + optional target placement (wireframe) */}
        {objects.map((obj) => (
          <DraggableBox
            key={obj.id}
            position={obj.position}
            color="#22d3ee"
            selected={selectedId === obj.id}
            onSelect={() => onSelect(obj.id)}
            onMove={(p) => onMoveObject(obj.id, p)}
          />
        ))}
        {target && (
          <DraggableBox
            position={target}
            color="#f59e0b"
            wireframe
            selected={selectedId === "target"}
            onSelect={() => onSelect("target")}
            onMove={onMoveTarget}
          />
        )}

        {/* large ground (both layers): robot + objects sit on it; in viewport AND camera feeds */}
        <mesh ref={(m) => m?.layers.enable(1)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[8, 8]} />
          <meshStandardMaterial color="#d4d7db" roughness={0.85} metalness={0} />
        </mesh>
        {/* pedestal the robot is mounted on */}
        <mesh ref={(m) => m?.layers.enable(1)} position={[0, PEDESTAL_H / 2, 0]}>
          <boxGeometry args={[0.2, PEDESTAL_H, 0.2]} />
          <meshStandardMaterial color="#5a5f66" roughness={0.6} metalness={0.3} />
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
        <GizmoHelper alignment="top-right" margin={[64, 64]}>
          <GizmoViewport axisColors={["#ef4444", "#22c55e", "#3b82f6"]} labelColor="#e5e7eb" />
        </GizmoHelper>
        <OrbitControls makeDefault target={[0, 0.45, 0]} minDistance={0.6} maxDistance={6} />
      </Canvas>
    </div>
  );
}
