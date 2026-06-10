"use client";

import { useEffect, useMemo, useRef, type RefObject } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { PerspectiveCamera, WebGLRenderTarget, Vector3, Quaternion } from "three";
import { findEndEffectorLink, type URDFRobot } from "@urdflow/urdf-web";

const W = 256;
const H = 256;

export interface CaptureRigProps {
  robot: URDFRobot;
  frontCanvas: RefObject<HTMLCanvasElement | null>;
  wristCanvas: RefObject<HTMLCanvasElement | null>;
  every?: number; // render to the panels every N frames (perf)
}

/**
 * Off-screen render of two cameras (fixed front + EE-mounted wrist) of the live
 * scene into the right-side DOM canvases. Runs at priority 0 so R3F still draws
 * the main viewport; we only redirect to render targets and restore.
 */
export function CaptureRig({ robot, frontCanvas, wristCanvas, every = 2 }: CaptureRigProps) {
  const { gl, scene } = useThree();
  const frontCam = useMemo(() => new PerspectiveCamera(45, 1, 0.01, 100), []);
  const wristCam = useMemo(() => new PerspectiveCamera(58, 1, 0.01, 100), []);
  const frontRT = useMemo(() => new WebGLRenderTarget(W, H), []);
  const wristRT = useMemo(() => new WebGLRenderTarget(W, H), []);
  const buf = useMemo(() => new Uint8Array(W * H * 4), []);
  const flip = useMemo(() => new Uint8ClampedArray(W * H * 4), []);
  const frameRef = useRef(0);

  const eeLink = useMemo(() => findEndEffectorLink(robot), [robot]);

  useEffect(() => {
    frontCam.position.set(0.7, 0.55, 0.7);
    frontCam.lookAt(0, 0.2, 0);
  }, [frontCam]);

  useEffect(() => {
    return () => {
      frontRT.dispose();
      wristRT.dispose();
    };
  }, [frontRT, wristRT]);

  function renderTo(cam: PerspectiveCamera, rt: WebGLRenderTarget, dom: HTMLCanvasElement | null) {
    gl.setRenderTarget(rt);
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

    // wrist camera rides the EE link, looking along its approach (+z) axis
    const link = robot.links[eeLink];
    if (link) {
      const p = link.getWorldPosition(new Vector3());
      const q = link.getWorldQuaternion(new Quaternion());
      wristCam.position.copy(p).add(new Vector3(0, 0.04, -0.12).applyQuaternion(q));
      wristCam.up.set(0, 1, 0);
      wristCam.lookAt(p.clone().add(new Vector3(0, 0, 0.2).applyQuaternion(q)));
    }

    renderTo(frontCam, frontRT, frontCanvas.current);
    renderTo(wristCam, wristRT, wristCanvas.current);
  });

  return null;
}
