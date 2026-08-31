import type { NextConfig } from "next";

function resolveDistDir(): string {
  const raw = process.env.NEXT_DIST_DIR;
  // Next 16 joins distDir onto the project root, so `/tmp/foo` becomes
  // `<repo>/tmp/foo` on this volume and JSON manifests get stray bytes.
  if (raw && !raw.startsWith("/") && raw !== "public") return raw;
  return ".next";
}

const nextConfig: NextConfig = {
  output: "export",
  distDir: resolveDistDir(),
  allowedDevOrigins: ["127.0.0.1"],
  // next dev --webpack writes AGENTS.md/CLAUDE.md and retriggers HMR;
  // a stuck BUILDING leaves waitForWebpackRuntimeHotUpdate pending so
  // <Link> transitions never commit (Open chats stayed on /enable).
  agentRules: false,
  images: {
    unoptimized: true,
  },
  webpack: (config, { isServer, webpack }) => {
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /\/\._[^/]+$/ }));
    // Do not merge Next's default ignored list — it can contain "".
    // AppleDouble `._*` writes on this volume keep webpack BUILDING, so
    // waitForWebpackRuntimeHotUpdate never resolves (Flight and hydrate hang).
    config.watchOptions = {
      aggregateTimeout: 300,
      ignored: ["**/node_modules/**", "**/._*", "**/.DS_Store"],
    };
    config.experiments = {
      ...config.experiments,
      asyncWebAssembly: true,
    };
    if (!isServer) {
      // paykit-wasm-node uses an expression import that keeps webpack BUILDING
      // on the client; Enable then never paints setEnabled after Ring approval.
      config.plugins.push(
        new webpack.IgnorePlugin({ resourceRegExp: /paykit-wasm-node/ }),
      );
      config.plugins.push(
        new webpack.NormalModuleReplacementPlugin(/^node:/, (resource: { request: string }) => {
          resource.request = resource.request.replace(/^node:/, "");
        }),
      );
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        path: false,
        os: false,
        "node:fs": false,
        "node:fs/promises": false,
        "node:path": false,
        "node:os": false,
      };
    }
    return config;
  },
};

export default nextConfig;
