"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera, WebGLRenderTarget, Vector3, type Object3D } from "three";
import { findEndEffectorLink, type URDFRobot } from "@urdflow/urdf-web";

const W = 256;
const H = 256;
const CAPTURE_LAYER = 1;

export interface CaptureRigProps {
  robot: URDFRobot;
  frontCanvas: RefObject<HTMLCanvasElement | null>;
  wristCanvas: RefObject<HTMLCanvasElement | null>;
  every?: number; // render to the panels every N frames (perf)
}

/**
 * Off-screen render of two cameras (fixed front + EE-mounted wrist) into the
 * right-side DOM canvases. Cameras render ONLY layer 1 (robot + box + a matte
 * ground), so editor helpers (grid, transform gizmo, view gizmo, contact shadow)
 * on layer 0 never appear — the footage looks like a real camera feed.
 */
export function CaptureRig({ robot, frontCanvas, wristCanvas, every = 2 }: CaptureRigProps) {
  const { gl, scene } = useThree();
  const frontCam = useMemo(() => new PerspectiveCamera(45, 1, 0.01, 100), []);
  const wristCam = useMemo(() => new PerspectiveCamera(60, 1, 0.01, 100), []);
  const frontRT = useMemo(() => new WebGLRenderTarget(W, H), []);
  const wristRT = useMemo(() => new WebGLRenderTarget(W, H), []);
  const buf = useMemo(() => new Uint8Array(W * H * 4), []);
  const flip = useMemo(() => new Uint8ClampedArray(W * H * 4), []);
  const frameRef = useRef(0);

  const eeLink = useMemo(() => findEndEffectorLink(robot), [robot]);

  // cameras only see the capture layer (no grid / gizmo / helpers)
  useEffect(() => {
    frontCam.layers.set(CAPTURE_LAYER);
    wristCam.layers.set(CAPTURE_LAYER);
    frontCam.position.set(0.7, 0.55, 0.7);
    frontCam.lookAt(0, 0.2, 0);
  }, [frontCam, wristCam]);

  // lights must also illuminate the capture layer, else the feed is black
  useEffect(() => {
    scene.traverse((o: Object3D) => {
      if ((o as { isLight?: boolean }).isLight) o.layers.enable(CAPTURE_LAYER);
    });
  }, [scene, robot]);

  useEffect(() => {
    return () => {
      frontRT.dispose();
      wristRT.dispose();
    };
  }, [frontRT, wristRT]);

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

  useFrame(() => {
    frameRef.current++;
    if (every > 1 && frameRef.current % every !== 0) return;

    // wrist camera: just above the EE, looking straight down at the grasp
    const link = robot.links[eeLink];
    if (link) {
      const p = link.getWorldPosition(new Vector3());
      wristCam.position.set(p.x, p.y + 0.18, p.z);
      wristCam.up.set(0, 0, -1); // down-looking camera needs a non-parallel up
      wristCam.lookAt(p.x, p.y - 0.3, p.z);
    }

    renderTo(frontCam, frontRT, frontCanvas.current);
    renderTo(wristCam, wristRT, wristCanvas.current);
  });

  return null;
}
