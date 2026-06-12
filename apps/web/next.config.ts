import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@urdflow/urdf-web"],
  // Turbopack (default since Next 16) builds the app. The MuJoCo bindings are never
  // bundled — they load unbundled from /public/mujoco.mjs in the physics worker
  // (turbopackIgnore'd), so the old webpack node-stub fallbacks are unnecessary.
  turbopack: {},
  // MuJoCo WASM is a pthread build: it needs crossOriginIsolated (SharedArrayBuffer).
  // Every asset we load is same-origin, so isolating the whole app is safe.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "Cross-Origin-Embedder-Policy", value: "require-corp" },
        ],
      },
    ];
  },
};

export default nextConfig;
