import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@urdflow/urdf-web"],
  webpack: (config) => {
    // mujoco (official WASM bindings) carries Node-only branches (worker_threads,
    // module, fs…) that never execute in the browser — stub them out of the bundle
    config.resolve.fallback = {
      ...config.resolve.fallback,
      module: false,
      worker_threads: false,
      fs: false,
      path: false,
      perf_hooks: false,
      crypto: false,
    };
    return config;
  },
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
