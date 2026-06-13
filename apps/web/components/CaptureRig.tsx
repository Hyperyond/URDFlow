"use client";

import { useCallback, useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import {
  Color,
  FloatType,
  NearestFilter,
  PerspectiveCamera,
  RGBAFormat,
  SRGBColorSpace,
  WebGLRenderTarget,
  Box3,
  Vector3,
  type Material,
  type Mesh,
  type Object3D,
} from "three";
import type { URDFRobot } from "@urdflow/urdf-web";
import {
  buildSegAssignments,
  cameraMeta,
  createDepthMaterial,
  depthToMM,
  flipToRGB,
  segMaterial,
  segToIds,
  type SensorFrame,
  type SensorSession,
} from "../lib/sensorCapture";

const W = 256;
const H = 256;
const CAPTURE_LAYER = 1;

export interface CaptureRigProps {
  robot: URDFRobot | null;
  frontCanvas: RefObject<HTMLCanvasElement | null>;
  topCanvas: RefObject<HTMLCanvasElement | null>;
  boxPosition?: [number, number, number];
  /** User-dragged camera positions; when set they override the auto-fit framing. */
  frontPos?: [number, number, number] | null;
  topPos?: [number, number, number] | null;
  /** Reports the auto-fitted positions once, so the scene can seed draggable proxies. */
  onAutoFrame?: (front: [number, number, number], top: [number, number, number]) => void;
  every?: number; // render to the panels every N frames (perf)
  /** Active recording episode — when set, RGB+depth+seg frames buffer at session.hz. */
  session?: SensorSession | null;
}

/**
 * Off-screen render of two FIXED cameras (front eye-level + top bird's-eye), matching
 * LeRobot's observation.front / observation.top. Cameras render ONLY layer 1 (robot +
 * box + matte ground); editor helpers on layer 0 never appear. Robot meshes load
 * async, so we (re)enable the capture layer on them every frame and re-fit framing
 * periodically once the bounding box settles.
 */
export function CaptureRig({
  robot,
  frontCanvas,
  topCanvas,
  boxPosition,
  frontPos,
  topPos,
  onAutoFrame,
  every = 2,
  session,
}: CaptureRigProps) {
  const { gl, scene } = useThree();
  const frontCam = useMemo(() => new PerspectiveCamera(50, 1, 0.01, 100), []);
  const topCam = useMemo(() => new PerspectiveCamera(58, 1, 0.01, 100), []);
  // sRGB color space so the off-screen feed matches the main viewport (not dark/linear)
  const frontRT = useMemo(() => new WebGLRenderTarget(W, H, { colorSpace: SRGBColorSpace }), []);
  const topRT = useMemo(() => new WebGLRenderTarget(W, H, { colorSpace: SRGBColorSpace }), []);
  // sensor targets: float view-z depth + byte-exact segmentation ids (no AA, no filtering)
  const depthRT = useMemo(
    () =>
      new WebGLRenderTarget(W, H, {
        type: FloatType,
        format: RGBAFormat,
        minFilter: NearestFilter,
        magFilter: NearestFilter,
      }),
    [],
  );
  const segRT = useMemo(
    () => new WebGLRenderTarget(W, H, { minFilter: NearestFilter, magFilter: NearestFilter }),
    [],
  );
  const depthMat = useMemo(() => createDepthMaterial(), []);
  const buf = useMemo(() => new Uint8Array(W * H * 4), []);
  const depthBuf = useMemo(() => new Float32Array(W * H * 4), []);
  const flip = useMemo(() => new Uint8ClampedArray(W * H * 4), []);
  const frameRef = useRef(0);

  // fit both cameras to the actual robot bounds (+ target box). User-dragged positions
  // (frontPos/topPos) win; otherwise we auto-fit and report the result up so the scene
  // can seed its draggable proxies at the same spot.
  const reframe = useCallback(() => {
    const bbox = new Box3();
    if (robot) {
      robot.updateMatrixWorld(true);
      bbox.setFromObject(robot);
    }
    if (boxPosition) bbox.expandByPoint(new Vector3(...boxPosition));
    if (bbox.isEmpty()) bbox.set(new Vector3(-0.3, 0, -0.3), new Vector3(0.5, 0.5, 0.5));
    const center = bbox.getCenter(new Vector3());
    const size = bbox.getSize(new Vector3());
    const radius = Math.max(size.x, size.y, size.z, 0.3) * 0.5 + 0.12;
    const fdist = (radius / Math.tan((frontCam.fov * Math.PI) / 360)) * 1.25;
    const fitFront: [number, number, number] = [
      center.x + fdist * 0.62,
      center.y + fdist * 0.5,
      center.z + fdist * 0.62,
    ];
    const tdist = (radius / Math.tan((topCam.fov * Math.PI) / 360)) * 1.25;
    const fitTop: [number, number, number] = [center.x, center.y + tdist, center.z];

    frontCam.position.set(...(frontPos ?? fitFront));
    frontCam.lookAt(center);
    topCam.up.set(0, 0, -1); // down-looking camera needs a non-parallel up
    topCam.position.set(...(topPos ?? fitTop));
    topCam.lookAt(center);

    // seed the proxies once, before the user has taken control of either camera
    if ((!frontPos || !topPos) && onAutoFrame) onAutoFrame(fitFront, fitTop);
  }, [robot, boxPosition, frontPos, topPos, onAutoFrame, frontCam, topCam]);

  useEffect(() => {
    frontCam.layers.set(CAPTURE_LAYER);
    topCam.layers.set(CAPTURE_LAYER);
    reframe();
  }, [reframe, frontCam, topCam]);

  // lights must also illuminate the capture layer, else the feed is black
  useEffect(() => {
    scene.traverse((o: Object3D) => {
      if ((o as { isLight?: boolean }).isLight) o.layers.enable(CAPTURE_LAYER);
    });
  }, [scene]);

  useEffect(() => {
    return () => {
      frontRT.dispose();
      topRT.dispose();
      depthRT.dispose();
      segRT.dispose();
    };
  }, [frontRT, topRT, depthRT, segRT]);

  function renderTo(cam: PerspectiveCamera, rt: WebGLRenderTarget, dom: HTMLCanvasElement | null) {
    gl.setRenderTarget(rt);
    gl.clear();
    gl.render(scene, cam);
    gl.setRenderTarget(null);
    if (!dom) return;
    gl.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    // WebGL pixels are bottom-up; ImageData is top-down → flip rows
    for (let y = 0; y < H; y++) {
      const src = (H - 1 - y) * W * 4;
      flip.set(buf.subarray(src, src + W * 4), y * W * 4);
    }
    dom.getContext("2d")?.putImageData(new ImageData(flip, W, H), 0, 0);
  }

  /** One synchronized RGB + depth + seg sample of both cameras into the session buffer. */
  function captureSensors(s: SensorSession, elapsed: number) {
    if (!s.due(elapsed) || !robot) return;
    frontCam.updateMatrixWorld();
    topCam.updateMatrixWorld();
    s.registerCamera(cameraMeta("front", W, H, frontCam));
    s.registerCamera(cameraMeta("top", W, H, topCam));

    const frame: SensorFrame = {
      t: s.episodeTime(elapsed),
      qpos: s.readQpos(robot),
      objPoses: s.readObjPoses(scene),
      rgb: {},
      depth: {},
      seg: {},
    };
    const assignments = buildSegAssignments(scene, CAPTURE_LAYER, s.segLabels);
    // neutralize viewport background/clear so sensor passes read 0 where nothing was hit
    const bg = scene.background;
    const clearColor = gl.getClearColor(new Color());
    const clearAlpha = gl.getClearAlpha();

    for (const [name, cam, rt] of [
      ["front", frontCam, frontRT],
      ["top", topCam, topRT],
    ] as const) {
      // RGB — render fresh (the preview pass may have skipped this frame)
      gl.setRenderTarget(rt);
      gl.clear();
      gl.render(scene, cam);
      gl.readRenderTargetPixels(rt, 0, 0, W, H, buf);
      frame.rgb[name] = flipToRGB(buf, W, H);

      scene.background = null;
      gl.setClearColor(0x000000, 1);

      // depth — override material writes view-space meters into R of a float target
      scene.overrideMaterial = depthMat;
      gl.setRenderTarget(depthRT);
      gl.clear();
      gl.render(scene, cam);
      gl.readRenderTargetPixels(depthRT, 0, 0, W, H, depthBuf);
      frame.depth[name] = depthToMM(depthBuf, W, H);
      scene.overrideMaterial = null;

      // segmentation — swap every capture-layer mesh to its flat id material
      const saved: [Mesh, Material | Material[]][] = assignments.map((a) => [a.mesh, a.mesh.material]);
      assignments.forEach((a) => (a.mesh.material = segMaterial(a.id)));
      gl.setRenderTarget(segRT);
      gl.clear();
      gl.render(scene, cam);
      gl.readRenderTargetPixels(segRT, 0, 0, W, H, buf);
      frame.seg[name] = segToIds(buf, W, H);
      saved.forEach(([m, mat]) => (m.material = mat));

      scene.background = bg;
      gl.setClearColor(clearColor, clearAlpha);
    }
    gl.setRenderTarget(null);
    s.frames.push(frame);
  }

  useFrame((state) => {
    frameRef.current++;
    // async-loaded robot meshes default to layer 0 — keep them on the capture layer
    if (robot) robot.traverse((o) => o.layers.enable(CAPTURE_LAYER));
    // re-fit periodically while meshes finish loading (bbox grows from empty → full)
    if (frameRef.current % 30 === 0) reframe();
    if (session) captureSensors(session, state.clock.elapsedTime);
    if (every > 1 && frameRef.current % every !== 0) return;
    renderTo(frontCam, frontRT, frontCanvas.current);
    renderTo(topCam, topRT, topCanvas.current);
  });

  return null;
}
