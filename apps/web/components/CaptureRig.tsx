"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera, WebGLRenderTarget, type Object3D } from "three";

const W = 256;
const H = 256;
const CAPTURE_LAYER = 1;

export interface CaptureRigProps {
  frontCanvas: RefObject<HTMLCanvasElement | null>;
  topCanvas: RefObject<HTMLCanvasElement | null>;
  boxPosition?: [number, number, number];
  every?: number; // render to the panels every N frames (perf)
}

/**
 * Off-screen render of two FIXED cameras — a front (eye-level) view and a top
 * (bird's-eye) view, matching LeRobot's observation.front / observation.top.
 * Cameras render ONLY layer 1 (robot + box + matte ground), so editor helpers
 * (grid, gizmos, contact shadow) on layer 0 never appear — looks like real feeds.
 */
export function CaptureRig({ frontCanvas, topCanvas, boxPosition, every = 2 }: CaptureRigProps) {
  const { gl, scene } = useThree();
  const frontCam = useMemo(() => new PerspectiveCamera(50, 1, 0.01, 100), []);
  const topCam = useMemo(() => new PerspectiveCamera(58, 1, 0.01, 100), []);
  const frontRT = useMemo(() => new WebGLRenderTarget(W, H), []);
  const topRT = useMemo(() => new WebGLRenderTarget(W, H), []);
  const buf = useMemo(() => new Uint8Array(W * H * 4), []);
  const flip = useMemo(() => new Uint8ClampedArray(W * H * 4), []);
  const frameRef = useRef(0);

  // auto-frame robot + target box; re-aims as the box is dragged so both stay fully in view
  useEffect(() => {
    frontCam.layers.set(CAPTURE_LAYER);
    topCam.layers.set(CAPTURE_LAYER);
    const b = boxPosition ?? [0.3, 0.2, 0.3];
    const cx = b[0] / 2; // midpoint robot(origin) ↔ box
    const cz = b[2] / 2;
    const cy = 0.3; // robot body height
    const reach = Math.hypot(b[0], b[2]) + 0.55; // span + margin
    frontCam.position.set(cx + reach * 0.85, cy + reach * 0.6, cz + reach * 0.85);
    frontCam.lookAt(cx, cy, cz);
    topCam.position.set(cx, cy + reach * 1.7, cz);
    topCam.up.set(0, 0, -1); // down-looking camera needs a non-parallel up
    topCam.lookAt(cx, 0.05, cz);
  }, [frontCam, topCam, boxPosition]);

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
    };
  }, [frontRT, topRT]);

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
    renderTo(frontCam, frontRT, frontCanvas.current);
    renderTo(topCam, topRT, topCanvas.current);
  });

  return null;
}
