"use client";

import { useState, useEffect, useMemo, type ReactNode, type RefObject } from "react";
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
import { ACESFilmicToneMapping, Box3, BufferGeometry, Float32BufferAttribute, Vector3, type Object3D } from "three";
import type { URDFRobot } from "@urdflow/urdf-web";
import { CaptureRig } from "./CaptureRig";

export interface SceneObj {
  id: string;
  position: [number, number, number];
  color?: string;
}

export interface CameraPose {
  front: [number, number, number] | null;
  top: [number, number, number] | null;
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
  cameraPoses?: CameraPose;
  onMoveCamera?: (which: "front" | "top", p: [number, number, number]) => void;
  onAutoFrameCameras?: (front: [number, number, number], top: [number, number, number]) => void;
  captureRefs?: { front: RefObject<HTMLCanvasElement | null>; top: RefObject<HTMLCanvasElement | null> };
}

/**
 * A pose-able scene item: renders `children` at `position`, click-to-select, and a
 * translate gizmo while selected. Meshes are promoted to the capture layer (1) so they
 * show in the camera feeds unless `captureVisible` is false (abstract markers / camera
 * proxies stay viewport-only).
 */
function SceneItem({
  position,
  selected,
  captureVisible = true,
  showY = false,
  onSelect,
  onMove,
  children,
}: {
  position: [number, number, number];
  selected: boolean;
  captureVisible?: boolean;
  showY?: boolean;
  onSelect: () => void;
  onMove: (p: [number, number, number]) => void;
  children: ReactNode;
}) {
  const [obj, setObj] = useState<Object3D | null>(null);
  useEffect(() => {
    if (captureVisible) obj?.traverse((o) => o.layers.enable(1));
  }, [obj, captureVisible]);
  return (
    <>
      <group
        ref={setObj}
        position={position}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      >
        {children}
      </group>
      {selected && obj && (
        <TransformControls
          object={obj}
          mode="translate"
          showY={showY}
          size={0.5}
          onObjectChange={() => {
            const p = obj.position;
            onMove([p.x, p.y, p.z]);
          }}
        />
      )}
    </>
  );
}

/**
 * UE/Unity-style camera gizmo: a small camera body with a lens barrel pointing along
 * +Z and a wireframe view-frustum opening toward what the capture camera actually
 * sees. The whole group lookAt()s the capture target, so dragging the proxy keeps the
 * frustum honestly indicating the feed's direction.
 */
function CameraProxy({
  color,
  selected,
  position,
  lookAt,
}: {
  color: string;
  selected: boolean;
  position: [number, number, number];
  lookAt: [number, number, number];
}) {
  const [grp, setGrp] = useState<Object3D | null>(null);
  // re-orient whenever the proxy is dragged or the capture target moves
  useEffect(() => {
    grp?.lookAt(new Vector3(...lookAt)); // plain Object3D: +Z faces the target
  }, [grp, position, lookAt]);

  // wireframe frustum: apex at the lens, opening forward (16:10-ish plate)
  const frustum = useMemo(() => {
    const z = 0.16;
    const hw = 0.062;
    const hh = 0.042;
    const c = [
      [-hw, -hh, z],
      [hw, -hh, z],
      [hw, hh, z],
      [-hw, hh, z],
    ];
    const pts: number[] = [];
    for (let i = 0; i < 4; i++) {
      pts.push(0, 0, 0.028, ...c[i]!); // apex → corners
      pts.push(...c[i]!, ...c[(i + 1) % 4]!); // far plate edges
    }
    // "up" tick on the far plate (Unity-style top indicator)
    pts.push(-hw * 0.35, hh, z, 0, hh + 0.022, z, 0, hh + 0.022, z, hw * 0.35, hh, z);
    const g = new BufferGeometry();
    g.setAttribute("position", new Float32BufferAttribute(pts, 3));
    return g;
  }, []);

  return (
    <group ref={setGrp}>
      {/* body */}
      <mesh>
        <boxGeometry args={[0.052, 0.038, 0.07]} />
        <meshStandardMaterial color="#2b2e36" metalness={0.4} roughness={0.45} />
      </mesh>
      {/* film reel bumps on top (classic editor camera silhouette) */}
      <mesh position={[0, 0.028, -0.014]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.016, 0.016, 0.05, 20]} />
        <meshStandardMaterial color="#2b2e36" metalness={0.4} roughness={0.45} />
      </mesh>
      <mesh position={[0, 0.028, 0.018]} rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.012, 0.012, 0.05, 20]} />
        <meshStandardMaterial color="#2b2e36" metalness={0.4} roughness={0.45} />
      </mesh>
      {/* lens barrel pointing forward */}
      <mesh position={[0, 0, 0.042]} rotation={[Math.PI / 2, 0, 0]}>
        <cylinderGeometry args={[0.013, 0.016, 0.022, 20]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={selected ? 0.7 : 0.35} roughness={0.35} />
      </mesh>
      {/* view-frustum wireframe — the actual "where is it looking" indicator */}
      <lineSegments geometry={frustum}>
        <lineBasicMaterial color={color} transparent opacity={selected ? 0.95 : 0.55} />
      </lineSegments>
    </group>
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
  cameraPoses,
  onMoveCamera,
  onAutoFrameCameras,
  captureRefs,
}: RobotViewerProps) {
  useEffect(() => {
    robot?.traverse((o) => o.layers.enable(1));
  }, [robot]);

  // where the capture cameras aim — camera gizmo frustums orient toward this
  const [aim, setAim] = useState<[number, number, number]>([0, 0.3, 0]);
  useEffect(() => {
    if (!robot) return;
    const t = setTimeout(() => {
      robot.updateMatrixWorld(true);
      const b = new Box3().setFromObject(robot);
      if (!b.isEmpty()) {
        const c = b.getCenter(new Vector3());
        setAim([c.x, c.y, c.z]);
      }
    }, 300); // after meshes load + ground fit
    return () => clearTimeout(t);
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
            frontPos={cameraPoses?.front}
            topPos={cameraPoses?.top}
            onAutoFrame={onAutoFrameCameras}
          />
        )}

        {/* scene objects: cubes to grasp */}
        {objects.map((obj) => (
          <SceneItem
            key={obj.id}
            position={obj.position}
            selected={selectedId === obj.id}
            onSelect={() => onSelect(obj.id)}
            onMove={(p) => onMoveObject(obj.id, p)}
          >
            <mesh>
              <boxGeometry args={[0.05, 0.05, 0.05]} />
              <meshStandardMaterial
                color={obj.color ?? "#22d3ee"}
                emissive={obj.color ?? "#22d3ee"}
                emissiveIntensity={selectedId === obj.id ? 0.5 : 0.25}
                roughness={0.4}
              />
            </mesh>
          </SceneItem>
        ))}

        {/* targets: translucent wireframe goal markers (viewport-only) */}
        {targets.map((t) => (
          <SceneItem
            key={t.id}
            position={t.position}
            selected={selectedId === t.id}
            captureVisible={false}
            onSelect={() => onSelect(t.id)}
            onMove={(p) => onMoveTarget(t.id, p)}
          >
            <mesh>
              <boxGeometry args={[0.05, 0.05, 0.05]} />
              <meshStandardMaterial
                color="#f59e0b"
                emissive="#f59e0b"
                emissiveIntensity={selectedId === t.id ? 0.5 : 0.25}
                roughness={0.4}
                wireframe
                transparent
                opacity={0.7}
              />
            </mesh>
          </SceneItem>
        ))}

        {/* draggable camera proxies — fine-tune observation.front / observation.top in-scene */}
        {cameraPoses?.front && onMoveCamera && (
          <SceneItem
            position={cameraPoses.front}
            selected={selectedId === "cam-front"}
            captureVisible={false}
            showY
            onSelect={() => onSelect("cam-front")}
            onMove={(p) => onMoveCamera("front", p)}
          >
            <CameraProxy color="#22d3ee" selected={selectedId === "cam-front"} position={cameraPoses.front} lookAt={aim} />
          </SceneItem>
        )}
        {cameraPoses?.top && onMoveCamera && (
          <SceneItem
            position={cameraPoses.top}
            selected={selectedId === "cam-top"}
            captureVisible={false}
            showY
            onSelect={() => onSelect("cam-top")}
            onMove={(p) => onMoveCamera("top", p)}
          >
            <CameraProxy color="#a78bfa" selected={selectedId === "cam-top"} position={cameraPoses.top} lookAt={aim} />
          </SceneItem>
        )}

        {/* work table for tall robots (humanoids): hugs the scene content and stays
            clear of wherever the robot is standing — no slab through its legs */}
        {surfaceY > 0 &&
          (() => {
            const pts = [...objects, ...targets]
              .map((o) => o.position)
              .filter((p) => p[1] < surfaceY + 0.12); // ignore a cube mid-carry
            if (pts.length === 0) return null;
            let minX = Math.min(...pts.map((p) => p[0])) - 0.14;
            let maxX = Math.max(...pts.map((p) => p[0])) + 0.14;
            let minZ = Math.min(...pts.map((p) => p[2])) - 0.14;
            let maxZ = Math.max(...pts.map((p) => p[2])) + 0.14;
            const bx = robot?.position.x ?? 0;
            const bz = robot?.position.z ?? 0;
            const CLEAR = 0.24; // keep this much room around the robot's stance
            if (bx <= minX) minX = Math.max(minX, bx + CLEAR);
            else if (bx >= maxX) maxX = Math.min(maxX, bx - CLEAR);
            if (bz <= minZ) minZ = Math.max(minZ, bz + CLEAR);
            else if (bz >= maxZ) maxZ = Math.min(maxZ, bz - CLEAR);
            // robot standing amid the content (cubes dragged to both sides): retreat the
            // slab from the robot along whichever axis costs the least table area
            if (bx > minX && bx < maxX && bz > minZ && bz < maxZ) {
              const cuts = [
                { keep: () => (minX = bx + CLEAR), cost: bx + CLEAR - minX },
                { keep: () => (maxX = bx - CLEAR), cost: maxX - (bx - CLEAR) },
                { keep: () => (minZ = bz + CLEAR), cost: bz + CLEAR - minZ },
                { keep: () => (maxZ = bz - CLEAR), cost: maxZ - (bz - CLEAR) },
              ];
              cuts.sort((a, b) => a.cost - b.cost)[0]!.keep();
            }
            const w = Math.max(0.3, maxX - minX);
            const d = Math.max(0.3, maxZ - minZ);
            return (
              <mesh
                ref={(m) => m?.layers.enable(1)}
                position={[(minX + maxX) / 2, surfaceY - 0.015, (minZ + maxZ) / 2]}
              >
                <boxGeometry args={[w, 0.03, d]} />
                <meshStandardMaterial color="#b9bec7" roughness={0.7} />
              </mesh>
            );
          })()}

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
