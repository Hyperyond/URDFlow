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

export interface SceneObj {
  id: string;
  position: [number, number, number];
  color?: string;
}

export interface RobotViewerProps {
  robot: URDFRobot | null;
  objects: SceneObj[];
  targets: { id: string; position: [number, number, number] }[];
  /** Height of the work surface (0 = objects sit on the floor, no table rendered). */
  surfaceY?: number;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMoveObject: (id: string, p: [number, number, number]) => void;
  onMoveTarget: (id: string, p: [number, number, number]) => void;
  captureRefs?: { front: RefObject<HTMLCanvasElement | null>; top: RefObject<HTMLCanvasElement | null> };
}

function DraggableBox({
  position,
  color,
  selected,
  wireframe,
  captureVisible = true,
  onSelect,
  onMove,
}: {
  position: [number, number, number];
  color: string;
  selected: boolean;
  wireframe?: boolean;
  captureVisible?: boolean;
  onSelect: () => void;
  onMove: (p: [number, number, number]) => void;
}) {
  const [mesh, setMesh] = useState<Mesh | null>(null);
  useEffect(() => {
    if (captureVisible) mesh?.layers.enable(1); // target marker stays off the camera layer
  }, [mesh, captureVisible]);
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
  targets,
  surfaceY = 0,
  selectedId,
  onSelect,
  onMoveObject,
  onMoveTarget,
  captureRefs,
}: RobotViewerProps) {
  useEffect(() => {
    robot?.traverse((o) => o.layers.enable(1));
  }, [robot]);

  // sit the robot on the ground: lift so its lowest point rests on y=0 (no floor
  // clipping). Applied imperatively — the editor owns x/z/yaw (walk-approach), the
  // viewer owns only the vertical lift, so no prop fights with base motion.
  useEffect(() => {
    if (!robot) return;
    const fit = () => {
      robot.updateMatrixWorld(true);
      const b = new Box3().setFromObject(robot);
      if (Number.isFinite(b.min.y)) {
        robot.position.y -= b.min.y; // idempotent: world min lands exactly on y=0
        robot.updateMatrixWorld(true);
      }
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

        {robot && <primitive object={robot} />}
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
            color={obj.color ?? "#22d3ee"}
            selected={selectedId === obj.id}
            onSelect={() => onSelect(obj.id)}
            onMove={(p) => onMoveObject(obj.id, p)}
          />
        ))}
        {targets.map((t) => (
          <DraggableBox
            key={t.id}
            position={t.position}
            color="#f59e0b"
            wireframe
            captureVisible={false}
            selected={selectedId === t.id}
            onSelect={() => onSelect(t.id)}
            onMove={(p) => onMoveTarget(t.id, p)}
          />
        ))}

        {/* work table for tall robots (humanoids): centered under the scene objects */}
        {surfaceY > 0 && (
          <mesh
            ref={(m) => m?.layers.enable(1)}
            position={[
              objects[0]?.position[0] ?? targets[0]?.position[0] ?? 0.35,
              surfaceY - 0.015,
              objects[0]?.position[2] ?? targets[0]?.position[2] ?? 0,
            ]}
          >
            <boxGeometry args={[1.0, 0.03, 0.8]} />
            <meshStandardMaterial color="#b9bec7" roughness={0.7} />
          </mesh>
        )}

        {/* large ground (both layers): robot + objects sit on it; in viewport AND camera feeds */}
        <mesh ref={(m) => m?.layers.enable(1)} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
          <planeGeometry args={[8, 8]} />
          <meshStandardMaterial color="#d4d7db" roughness={0.85} metalness={0} />
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
